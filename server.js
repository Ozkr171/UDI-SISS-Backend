const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');

const app = express();

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json()); 
// Permite servir las imágenes y PDFs físicamente desde la carpeta uploads
app.use('/uploads', express.static('uploads'));

// --- CONFIGURACIÓN DE BASE DE DATOS ---
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      
    password: '',      
    database: 'udisiss'
});

db.connect(err => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        return;
    }
    console.log('Conectado exitosamente a la base de datos MySQL');
});

// --- CONFIGURACIÓN DE MULTER (ALMACENAMIENTO) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); 
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); 
    }
});
const upload = multer({ storage: storage });

// ==========================================
// CONTROLADORES DE LÓGICA (BACKEND)
// ==========================================

const procesarReporte = (req, res, db) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No se seleccionó ningún archivo PDF.' });
    
    const { usuario_nombre, mes } = req.body;
    const nombreArchivo = req.file.filename;

    if (!usuario_nombre || !mes) return res.status(400).json({ success: false, message: 'Faltan metadatos (Usuario o Mes).' });

    const query = 'INSERT INTO reportes (usuario_nombre, mes, nombre_archivo, fecha_subida, estado) VALUES (?, ?, ?, NOW(), "En proceso de validación")';
    db.query(query, [usuario_nombre, mes, nombreArchivo], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error al registrar en la base de datos.' });
        res.status(201).json({ success: true, message: 'Archivo PDF procesado y guardado.' });
    });
};

const procesarEvidencia = (req, res, db) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No se seleccionó ninguna imagen.' });

    const { usuario_nombre, descripcion } = req.body;
    const nombreArchivo = req.file.filename;

    if (!usuario_nombre || !descripcion) return res.status(400).json({ success: false, message: 'La descripción es obligatoria.' });

    const query = 'INSERT INTO evidencias (usuario_nombre, descripcion, nombre_archivo, fecha_subida) VALUES (?, ?, ?, NOW())';
    db.query(query, [usuario_nombre, descripcion, nombreArchivo], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error al registrar la evidencia.' });
        res.status(201).json({ success: true, message: 'Fotografía guardada exitosamente.' });
    });
};

// ==========================================
// RUTAS DE AUTENTICACIÓN
// ==========================================
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = 'SELECT * FROM usuarios WHERE correo = ? AND password = ?';
    db.query(query, [email, password], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error en el servidor' });
        if (results.length > 0) {
            const usuario = results[0];
            res.json({ success: true, role: usuario.rol, nombre: usuario.nombre });
        } else {
            res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
        }
    });
});

// ==========================================
// RUTAS DE REPORTES Y EVIDENCIAS
// ==========================================

// SUBIDA (POST)
app.post('/api/reportes', upload.single('archivo'), (req, res) => procesarReporte(req, res, db));
app.post('/api/evidencias', upload.single('foto'), (req, res) => procesarEvidencia(req, res, db));

// VALIDACIÓN (PUT) - Solo Jefe (AHORA ACEPTA COMENTARIOS DE RECHAZO)
app.put('/api/reportes/:id/estado', (req, res) => {
    const { id } = req.params;
    const { nuevoEstado, comentario } = req.body;
    
    if (!nuevoEstado) return res.status(400).json({ success: false, message: 'Estado requerido' });

    // Actualizamos el estado y el comentario (si es que hay uno)
    const query = 'UPDATE reportes SET estado = ?, comentario_jefe = ? WHERE id = ?';
    db.query(query, [nuevoEstado, comentario || null, id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error al actualizar estado' });
        res.json({ success: true, message: 'Estado del reporte actualizado correctamente' });
    });
});

// CONSULTA GLOBAL (GET) - Jefe de UDI (AHORA INCLUYE EL COMENTARIO)
app.get('/api/reportes-global', (req, res) => {
    // Agregamos comentario_jefe a la consulta SQL
    const query = 'SELECT id, usuario_nombre, mes, nombre_archivo, fecha_subida, estado, comentario_jefe FROM reportes ORDER BY fecha_subida DESC';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error obteniendo reportes globales' });
        res.status(200).json(results);
    });
});

// CONSULTA INDIVIDUAL (GET) - Prestador (Ve solo lo suyo)
app.get('/api/reportes/:nombre', (req, res) => {
    db.query('SELECT * FROM reportes WHERE usuario_nombre = ? ORDER BY id DESC', [req.params.nombre], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error obteniendo reportes' });
        res.status(200).json(results);
    });
});

// CONSULTA GLOBAL (GET) - Galería de Evidencias (Pública para todos)
app.get('/api/evidencias', (req, res) => {
    db.query('SELECT * FROM evidencias ORDER BY id DESC', (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error obteniendo todas las evidencias' });
        res.status(200).json(results);
    });
});

// ==========================================
// RUTAS DE BITÁCORA
// ==========================================
app.get('/api/bitacora', (req, res) => {
    db.query('SELECT * FROM bitacora ORDER BY id DESC', (err, results) => {
        if (err) return res.status(500).json({ error: 'Error obteniendo bitácora' });
        res.json(results);
    });
});

app.post('/api/bitacora', (req, res) => {
    // 1. Extraemos la "hora" del body
    const { fecha, hora, reporte, donde, resultado, comentarios, prestadores_asignados } = req.body;
    
    // 2. Agregamos "hora" a la consulta SQL
    const query = 'INSERT INTO bitacora (fecha, hora, reporte, donde, resultado, comentarios, prestadores_asignados) VALUES (?, ?, ?, ?, ?, ?, ?)';
    
    db.query(query, [fecha, hora, reporte, donde, resultado, comentarios, prestadores_asignados], (err, result) => {
        if (err) {
            console.error("Error SQL en Bitácora:", err);
            return res.status(500).json({ error: 'Error guardando el reporte' });
        }
        res.json({ success: true, message: 'Reporte agregado', id: result.insertId });
    });
});

// ==========================================
// RUTAS DE ASISTENCIA (NUEVA LÓGICA DIARIA)
// ==========================================

// 1. GET: Obtener asistencia de un día específico (Para el Jefe)
app.get('/api/asistencia/dia/:fecha', (req, res) => {
    const { fecha } = req.params;
    // Hacemos un JOIN: Sacamos a TODOS los prestadores y los cruzamos con sus asistencias de esa fecha
    const query = `
        SELECT u.nombre as usuario_nombre, a.hora_entrada, a.hora_salida, a.estado 
        FROM usuarios u 
        LEFT JOIN asistencias a ON u.nombre = a.usuario_nombre AND a.fecha = ?
        WHERE u.rol = 'Prestador de Servicio'
    `;
    db.query(query, [fecha], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error en BD' });
        res.json(results);
    });
});

// 2. GET: Historial personal (Para el Prestador)
app.get('/api/asistencia/historial/:nombre', (req, res) => {
    const query = 'SELECT fecha, hora_entrada, hora_salida, estado FROM asistencias WHERE usuario_nombre = ? ORDER BY fecha DESC';
    db.query(query, [req.params.nombre], (err, results) => {
        if (err) return res.status(500).json({ success: false });
        res.json(results);
    });
});

// 3. POST: Registrar Entrada, Salida o Falta
app.post('/api/asistencia/registro', (req, res) => {
    const { usuario_nombre, fecha, tipo, hora } = req.body;

    // Buscamos si ya existe la fila de ese día para ese usuario
    db.query('SELECT * FROM asistencias WHERE usuario_nombre = ? AND fecha = ?', [usuario_nombre, fecha], (err, results) => {
        if (err) return res.status(500).json({ success: false });

        if (results.length === 0) {
            // No existe la fila de hoy. La creamos.
            let horaEntrada = tipo === 'Entrada' ? hora : null;
            let estado = tipo === 'Falta' ? 'Falta' : 'Presente';
            
            db.query('INSERT INTO asistencias (usuario_nombre, fecha, hora_entrada, estado) VALUES (?, ?, ?, ?)', 
            [usuario_nombre, fecha, horaEntrada, estado], (err2) => {
                if (err2) return res.status(500).json({ success: false });
                res.json({ success: true });
            });
        } else {
            // Ya existe la fila de hoy. La actualizamos.
            if (tipo === 'Salida') {
                db.query('UPDATE asistencias SET hora_salida = ? WHERE usuario_nombre = ? AND fecha = ?', [hora, usuario_nombre, fecha], (err2) => {
                    if (err2) return res.status(500).json({ success: false });
                    res.json({ success: true });
                });
            } else if (tipo === 'Falta') {
                db.query('UPDATE asistencias SET estado = "Falta", hora_entrada = NULL, hora_salida = NULL WHERE usuario_nombre = ? AND fecha = ?', [usuario_nombre, fecha], (err2) => {
                    if (err2) return res.status(500).json({ success: false });
                    res.json({ success: true });
                });
            }
        }
    });
});

// ==========================================
// GESTIÓN DE USUARIOS Y ESTADÍSTICAS
// ==========================================
app.post('/api/usuarios', (req, res) => {
    const { nombre, correo, password, boleta, horario } = req.body;
    const query = 'INSERT INTO usuarios (nombre, correo, password, rol, boleta, horario) VALUES (?, ?, ?, "Prestador de Servicio", ?, ?)';
    db.query(query, [nombre, correo, password, boleta, horario], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error al registrar' });
        res.json({ success: true, message: 'Usuario registrado' });
    });
});

// ==========================================
// GESTIÓN DE USUARIOS Y ESTADO DEL SERVICIO
// ==========================================
app.post('/api/usuarios', (req, res) => {
    const { nombre, correo, password, boleta, horario } = req.body;
    const query = 'INSERT INTO usuarios (nombre, correo, password, rol, boleta, horario) VALUES (?, ?, ?, "Prestador de Servicio", ?, ?)';
    db.query(query, [nombre, correo, password, boleta, horario], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error al registrar' });
        res.json({ success: true, message: 'Usuario registrado' });
    });
});

// GET: Estado general de todos los prestadores (Para el Jefe)
app.get('/api/estado-prestadores', (req, res) => {
    const query = `
        SELECT 
            u.id, u.nombre, u.boleta, u.estado_servicio, u.motivo_baja,
            IFNULL(SUM(TIME_TO_SEC(TIMEDIFF(a.hora_salida, a.hora_entrada))) / 3600, 0) AS horas_totales,
            (SELECT COUNT(*) FROM reportes r WHERE r.usuario_nombre = u.nombre AND r.estado = 'Validado') AS reportes_validados
        FROM usuarios u
        LEFT JOIN asistencias a ON u.nombre = a.usuario_nombre AND a.hora_salida IS NOT NULL
        WHERE u.rol = 'Prestador de Servicio'
        GROUP BY u.id
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en BD' });
        res.json(results);
    });
});

// GET: Estado personal (Para el Prestador)
app.get('/api/mi-estado/:nombre', (req, res) => {
    const query = `
        SELECT 
            u.id, u.nombre, u.boleta, u.estado_servicio, u.motivo_baja,
            IFNULL(SUM(TIME_TO_SEC(TIMEDIFF(a.hora_salida, a.hora_entrada))) / 3600, 0) AS horas_totales,
            (SELECT COUNT(*) FROM reportes r WHERE r.usuario_nombre = u.nombre AND r.estado = 'Validado') AS reportes_validados
        FROM usuarios u
        LEFT JOIN asistencias a ON u.nombre = a.usuario_nombre AND a.hora_salida IS NOT NULL
        WHERE u.rol = 'Prestador de Servicio' AND u.nombre = ?
        GROUP BY u.id
    `;
    db.query(query, [req.params.nombre], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en BD' });
        res.json(results[0] || {}); // Retornamos un solo objeto
    });
});

// PUT: Liberar Servicio (Jefe aprueba)
app.put('/api/usuarios/:id/liberar', (req, res) => {
    db.query('UPDATE usuarios SET estado_servicio = "Liberado" WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// PUT: Dar de Baja (Jefe expulsa)
app.put('/api/usuarios/:id/baja', (req, res) => {
    const { motivo } = req.body;
    db.query('UPDATE usuarios SET estado_servicio = "Baja", motivo_baja = ? WHERE id = ?', [motivo, req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// GET: Lista simple de prestadores (Revivida para la tabla y la Bitácora)
app.get('/api/prestadores', (req, res) => {
    const query = 'SELECT id, boleta, nombre, horario, correo FROM usuarios WHERE rol = "Prestador de Servicio"';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Error obteniendo prestadores' });
        res.json(results);
    });
});

// --- INICIAR SERVIDOR ---
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});