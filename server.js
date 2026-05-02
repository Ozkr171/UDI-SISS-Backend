const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();

app.use(cors());
app.use(express.json()); 
app.use('/uploads', express.static('uploads'));

const rateLimit = require('express-rate-limit');

const limitadorFormularios = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 10, 
    message: { success: false, message: "Demasiadas peticiones. Por favor, espera 5 minutos." }
});

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

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'udisiss.suport@gmail.com',
        pass: 'pzyg uczv ewzy wejq' 
    }
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, 'uploads/'); },
    filename: (req, file, cb) => { cb(null, Date.now() + path.extname(file.originalname)); }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const formatosPermitidos = [
            'application/pdf',
            'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
            'application/vnd.ms-excel', 
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
        ];

        if (formatosPermitidos.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Formato de archivo no permitido. Solo PDF, Word, Excel o Imágenes.'));
        }
    }
});

// ==========================================
// CONTROLADORES DE LÓGICA 
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
    const query = 'SELECT * FROM usuarios WHERE correo = ?'; 
    db.query(query, [email], async (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error en el servidor' });
        
        if (results.length > 0) {
            const usuario = results[0];
            const match = await bcrypt.compare(password, usuario.password);
            
            if (match) {
                res.json({ success: true, role: usuario.rol, nombre: usuario.nombre });
            } else {
                res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
            }
        } else {
            res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
        }
    });
});

app.put('/api/cambiar-password', (req, res) => {
    const { nombre, actualPassword, nuevaPassword } = req.body;
    
    db.query('SELECT password FROM usuarios WHERE nombre = ?', [nombre], async (err, results) => {
        if (err || results.length === 0) return res.status(500).json({ success: false, message: 'Error de BD' });
        
        const match = await bcrypt.compare(actualPassword, results[0].password);
        if (!match) return res.status(400).json({ success: false, message: 'Tu contraseña actual es incorrecta.' });
        
        const hashedNueva = await bcrypt.hash(nuevaPassword, 10);
        db.query('UPDATE usuarios SET password = ? WHERE nombre = ?', [hashedNueva, nombre], (err2) => {
            if (err2) return res.status(500).json({ success: false, message: 'Error al actualizar' });
            res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
        });
    });
});

app.post('/api/recuperar-password', (req, res) => {
    const { email } = req.body;
    
    db.query('SELECT * FROM usuarios WHERE correo = ?', [email], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error en el servidor' });
        if (results.length === 0) return res.status(404).json({ success: false, message: 'No existe una cuenta con ese correo.' });

        const usuario = results[0];
        const nuevaTempPassword = Math.random().toString(36).slice(-8); 

        db.query('UPDATE usuarios SET password = ? WHERE correo = ?', [nuevaTempPassword, email], (err2) => {
            if (err2) return res.status(500).json({ success: false, message: 'Error al resetear' });

            const mailOptions = {
                from: 'Soporte UDI-SISS <udisiss.suport@gmail.com>',
                to: email,
                subject: 'Recuperación de Contraseña - UDI-SISS',
                text: `Hola ${usuario.nombre},\n\nSe ha solicitado restablecer tu contraseña del sistema UDI-SISS.\n\nTu nueva contraseña temporal es: ${nuevaTempPassword}\n\nTe recomendamos iniciar sesión y cambiarla inmediatamente desde tu panel "Mi Estado".`
            };

            transporter.sendMail(mailOptions, (error) => {
                if (error) return res.status(500).json({ success: false, message: 'Error enviando el correo. Verifica las credenciales del servidor.' });
                res.json({ success: true, message: 'Te hemos enviado un correo con tu nueva contraseña temporal.' });
            });
        });
    });
});

// ==========================================
// RUTAS DE REPORTES Y EVIDENCIAS
// ==========================================
app.post('/api/reportes', upload.single('archivo'), (req, res) => procesarReporte(req, res, db));
app.post('/api/evidencias', upload.single('foto'), (req, res) => procesarEvidencia(req, res, db));

app.put('/api/reportes/:id/estado', (req, res) => {
    const { id } = req.params;
    const { nuevoEstado, comentario } = req.body;
    
    if (!nuevoEstado) return res.status(400).json({ success: false, message: 'Estado requerido' });

    const query = 'UPDATE reportes SET estado = ?, comentario_jefe = ? WHERE id = ?';
    db.query(query, [nuevoEstado, comentario || null, id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error al actualizar estado' });
        res.json({ success: true, message: 'Estado del reporte actualizado correctamente' });
    });
});

app.get('/api/reportes-global', (req, res) => {
    const query = 'SELECT id, usuario_nombre, mes, nombre_archivo, fecha_subida, estado, comentario_jefe FROM reportes ORDER BY fecha_subida DESC';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error obteniendo reportes globales' });
        res.status(200).json(results);
    });
});

app.get('/api/reportes/:nombre', (req, res) => {
    db.query('SELECT * FROM reportes WHERE usuario_nombre = ? ORDER BY id DESC', [req.params.nombre], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error obteniendo reportes' });
        res.status(200).json(results);
    });
});

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
    const { fecha, hora, reporte, donde, resultado, comentarios, prestadores_asignados } = req.body;
    const query = 'INSERT INTO bitacora (fecha, hora, reporte, donde, resultado, comentarios, prestadores_asignados) VALUES (?, ?, ?, ?, ?, ?, ?)';
    
    db.query(query, [fecha, hora, reporte, donde, resultado, comentarios, prestadores_asignados], (err, result) => {
        if (err) {
            console.error("Error SQL en Bitácora:", err);
            return res.status(500).json({ error: 'Error guardando el reporte' });
        }
        res.json({ success: true, message: 'Reporte agregado', id: result.insertId });
    });
});

app.put('/api/bitacora/:id/estado', (req, res) => {
    const { id } = req.params;
    const { nuevoEstado, solucion, resueltoPor } = req.body; 

    const query = `
        UPDATE bitacora 
        SET resultado = ?, 
            comentarios = CONCAT(COALESCE(comentarios, ''), ' | [Resuelto por ', ?, ']: ', ?) 
        WHERE id = ?
    `;

    db.query(query, [nuevoEstado, resueltoPor, solucion, id], (err, result) => {
        if (err) {
            console.error("Error al actualizar la bitácora:", err);
            return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
        }
        res.json({ success: true, message: 'El reporte ha sido actualizado y resuelto.' });
    });
});

// ==========================================
// RUTAS DE ASISTENCIA 
// ==========================================
app.get('/api/asistencia/dia/:fecha', (req, res) => {
    const { fecha } = req.params;
    const query = `
        SELECT u.nombre as usuario_nombre, a.hora_entrada, a.hora_salida, a.estado 
        FROM usuarios u 
        LEFT JOIN asistencias a ON u.nombre = a.usuario_nombre AND a.fecha = ?
        WHERE u.rol = 'Prestador de Servicio' AND u.estado_servicio != 'Baja'
    `;
    db.query(query, [fecha], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: 'Error en BD' });
        res.json(results);
    });
});

app.get('/api/asistencia/historial/:nombre', (req, res) => {
    const query = 'SELECT fecha, hora_entrada, hora_salida, estado FROM asistencias WHERE usuario_nombre = ? ORDER BY fecha DESC';
    db.query(query, [req.params.nombre], (err, results) => {
        if (err) return res.status(500).json({ success: false });
        res.json(results);
    });
});

app.post('/api/asistencia/registro', (req, res) => {
    const { usuario_nombre, fecha, tipo } = req.body; 

    db.query('SELECT * FROM asistencias WHERE usuario_nombre = ? AND fecha = ?', [usuario_nombre, fecha], (err, results) => {
        if (err) return res.status(500).json({ success: false });

        if (results.length === 0) {
            let estado = tipo === 'Falta' ? 'Falta' : 'Presente';
            let queryInsert = tipo === 'Entrada' 
                ? 'INSERT INTO asistencias (usuario_nombre, fecha, hora_entrada, estado) VALUES (?, ?, CURTIME(), ?)'
                : 'INSERT INTO asistencias (usuario_nombre, fecha, hora_entrada, estado) VALUES (?, ?, NULL, ?)';
                
            db.query(queryInsert, [usuario_nombre, fecha, estado], (err2) => {
                if (err2) return res.status(500).json({ success: false });
                res.json({ success: true });
            });
        } else {
            if (tipo === 'Salida') {
                db.query('UPDATE asistencias SET hora_salida = CURTIME() WHERE usuario_nombre = ? AND fecha = ?', [usuario_nombre, fecha], (err2) => {
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
// GESTIÓN DE USUARIOS Y ESTADO DEL SERVICIO
// ==========================================
app.post('/api/usuarios', async (req, res) => {
    const { nombre, correo, password, boleta, horario } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10); 
        const query = 'INSERT INTO usuarios (nombre, correo, password, rol, boleta, horario) VALUES (?, ?, ?, "Prestador de Servicio", ?, ?)';
        db.query(query, [nombre, correo, hashedPassword, boleta, horario], (err) => {
            if (err) return res.status(500).json({ success: false, message: 'Error al registrar' });
            res.json({ success: true, message: 'Usuario registrado' });
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error encriptando contraseña' });
    }
});

app.get('/api/estado-prestadores', (req, res) => {
    const query = `
        SELECT 
            u.id, u.nombre, u.boleta, u.estado_servicio, u.motivo_baja,
            (IFNULL(SUM(TIME_TO_SEC(TIMEDIFF(a.hora_salida, a.hora_entrada))) / 3600, 0) + IFNULL(u.horas_adicionales, 0)) AS horas_totales,
            (SELECT COUNT(*) FROM reportes r WHERE r.usuario_nombre = u.nombre AND r.estado = 'Validado') AS reportes_validados,
            (SELECT COUNT(*) FROM bitacora b WHERE b.prestadores_asignados LIKE CONCAT('%', u.nombre, '%') AND b.resultado = 'Exitoso') AS reportes_exitosos
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

app.get('/api/mi-estado/:nombre', (req, res) => {
    const query = `
        SELECT 
            u.id, u.nombre, u.boleta, u.estado_servicio, u.motivo_baja,
            (IFNULL(SUM(TIME_TO_SEC(TIMEDIFF(a.hora_salida, a.hora_entrada))) / 3600, 0) + IFNULL(u.horas_adicionales, 0)) AS horas_totales,
            (SELECT COUNT(*) FROM reportes r WHERE r.usuario_nombre = u.nombre AND r.estado = 'Validado') AS reportes_validados,
            (SELECT COUNT(*) FROM bitacora b WHERE b.prestadores_asignados LIKE CONCAT('%', u.nombre, '%') AND b.resultado = 'Exitoso') AS reportes_exitosos
        FROM usuarios u
        LEFT JOIN asistencias a ON u.nombre = a.usuario_nombre AND a.hora_salida IS NOT NULL
        WHERE u.rol = 'Prestador de Servicio' AND u.nombre = ?
        GROUP BY u.id
    `;
    db.query(query, [req.params.nombre], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en BD' });
        res.json(results[0] || {}); 
    });
});

app.put('/api/usuarios/:id/sumar-horas', (req, res) => {
    const { horas_extra } = req.body;
    const query = 'UPDATE usuarios SET horas_adicionales = IFNULL(horas_adicionales, 0) + ? WHERE id = ?';
    db.query(query, [horas_extra, req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.put('/api/usuarios/:id/restar-horas', (req, res) => {
    const { horas_restadas, motivo, nombre_prestador } = req.body;
    
    const queryUpdate = 'UPDATE usuarios SET horas_adicionales = IFNULL(horas_adicionales, 0) - ? WHERE id = ?';
    db.query(queryUpdate, [horas_restadas, req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error restando horas' });
        
        const mensaje = `⚠️ Se te han restado ${horas_restadas} hora(s) de tu servicio. Motivo: ${motivo}`;
        db.query('INSERT INTO notificaciones (usuario_nombre, mensaje) VALUES (?, ?)', [nombre_prestador, mensaje], (err2) => {
            if (err2) return res.status(500).json({ success: false, message: 'Error creando notificación' });
            res.json({ success: true, message: 'Horas restadas y notificación enviada.' });
        });
    });
});

app.put('/api/usuarios/:id/liberar', (req, res) => {
    db.query('UPDATE usuarios SET estado_servicio = "Liberado" WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.put('/api/usuarios/:id/baja', (req, res) => {
    const { motivo } = req.body;
    db.query('UPDATE usuarios SET estado_servicio = "Baja", motivo_baja = ? WHERE id = ?', [motivo, req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

app.get('/api/prestadores', (req, res) => {
    const query = 'SELECT id, boleta, nombre, horario, correo FROM usuarios WHERE rol = "Prestador de Servicio" AND estado_servicio != "Baja"';
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Error obteniendo prestadores' });
        res.json(results);
    });
});

// ==========================================
// NOTIFICACIONES
// ==========================================
app.get('/api/notificaciones/:nombre', (req, res) => {
    db.query('SELECT * FROM notificaciones WHERE usuario_nombre = ? AND leida = FALSE', [req.params.nombre], (err, results) => {
        if (err) return res.status(500).json({ success: false });
        res.json(results);
    });
});

app.put('/api/notificaciones/:id/leida', (req, res) => {
    db.query('UPDATE notificaciones SET leida = TRUE WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true });
    });
});

// ==========================================
// RUTAS DE PRÉSTAMOS DE MATERIAL
// ==========================================
app.get('/api/prestamos', (req, res) => {
    db.query('SELECT * FROM prestamos_material ORDER BY id DESC', (err, results) => {
        if (err) return res.status(500).json({ error: 'Error obteniendo préstamos' });
        res.json(results);
    });
});

app.post('/api/prestamos', (req, res) => {
    const { solicitante, identificacion, material, fecha, hora_prestamo, prestador_entrega } = req.body;
    
    const query = 'INSERT INTO prestamos_material (solicitante, identificacion, material, fecha, hora_prestamo, prestador_entrega) VALUES (?, ?, ?, ?, ?, ?)';
    
    db.query(query, [solicitante, identificacion, material, fecha, hora_prestamo, prestador_entrega], (err, result) => {
        if (err) {
            console.error("Error al registrar préstamo:", err);
            return res.status(500).json({ error: 'Error al registrar el préstamo' });
        }
        res.json({ success: true, message: 'Préstamo registrado exitosamente' });
    });
});

app.put('/api/prestamos/:id/devolucion', (req, res) => {
    const { id } = req.params;
    const { hora_devolucion, estado_material, prestador_recibe } = req.body;
    
    const query = 'UPDATE prestamos_material SET hora_devolucion = ?, estado_material = ?, prestador_recibe = ? WHERE id = ?';
    
    db.query(query, [hora_devolucion, estado_material, prestador_recibe, id], (err, result) => {
        if (err) {
            console.error("Error al registrar devolución:", err);
            return res.status(500).json({ error: 'Error al registrar la devolución' });
        }
        res.json({ success: true, message: 'Devolución y estado registrados exitosamente' });
    });
});

// ==========================================
// RUTAS DE REPOSITORIO DE MATERIALES (UDI)
// ==========================================
app.get('/api/materiales/:rol/:nombre', (req, res) => {
    const { rol, nombre } = req.params;
    let query = '';
    let params = [];

    if (rol === 'Jefe de UDI') {
        query = 'SELECT * FROM materiales_udi ORDER BY id DESC';
    } else {
        query = 'SELECT * FROM materiales_udi WHERE estado = "Aprobado" OR subido_por = ? ORDER BY id DESC';
        params = [nombre];
    }

    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ error: 'Error obteniendo materiales' });
        res.json(results);
    });
});

app.post('/api/materiales', upload.single('archivo'), (req, res) => {
    const { titulo, categoria, tipo_recurso, link_url, subido_por, rol_usuario } = req.body;
    
    const estado_inicial = rol_usuario === 'Jefe de UDI' ? 'Aprobado' : 'Pendiente';
    let ruta_archivo = '';

    if (tipo_recurso === 'Archivo') {
        if (!req.file) return res.status(400).json({ success: false, message: 'Falta el archivo.' });
        ruta_archivo = req.file.filename;
    } else {
        if (!link_url) return res.status(400).json({ success: false, message: 'Falta el link.' });
        ruta_archivo = link_url;
    }

    const query = 'INSERT INTO materiales_udi (titulo, categoria, tipo_recurso, ruta_archivo, subido_por, estado) VALUES (?, ?, ?, ?, ?, ?)';
    
    db.query(query, [titulo, categoria, tipo_recurso, ruta_archivo, subido_por, estado_inicial], (err) => {
        if (err) {
            console.error("Error al subir material:", err);
            return res.status(500).json({ success: false, message: 'Error en la base de datos' });
        }
        res.json({ success: true, message: 'Material subido correctamente.' });
    });
});

app.put('/api/materiales/:id/estado', (req, res) => {
    const { id } = req.params;
    const { nuevoEstado, revisado_por } = req.body;

    const query = 'UPDATE materiales_udi SET estado = ?, revisado_por = ? WHERE id = ?';
    
    db.query(query, [nuevoEstado, revisado_por, id], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error al actualizar estado' });
        res.json({ success: true, message: `Material ${nuevoEstado.toLowerCase()} con éxito.` });
    });
});

// ==========================================
// RUTAS DE TRABAJOS ESPECIALES
// ==========================================

// GET: Obtener trabajos especiales (Jefe ve todos, Prestador solo los suyos)
app.get('/api/trabajos/:rol/:nombre', (req, res) => {
    const { rol, nombre } = req.params;
    let query = '';
    let params = [];

    if (rol === 'Jefe de UDI') {
        query = 'SELECT * FROM trabajos_especiales ORDER BY id DESC';
    } else {
        query = 'SELECT * FROM trabajos_especiales WHERE prestador_solicitante = ? ORDER BY id DESC';
        params = [nombre];
    }

    db.query(query, params, (err, results) => {
        if (err) return res.status(500).json({ error: 'Error obteniendo trabajos' });
        res.json(results);
    });
});

// POST: Prestador manda solicitud inicial de trabajo extra
app.post('/api/trabajos/solicitar', (req, res) => {
    const { prestador_solicitante } = req.body;
    const query = 'INSERT INTO trabajos_especiales (prestador_solicitante, estado) VALUES (?, "Solicitado")';
    db.query(query, [prestador_solicitante], (err) => {
        if (err) return res.status(500).json({ success: false, message: 'Error al solicitar trabajo' });
        res.json({ success: true, message: 'Solicitud enviada al Jefe de UDI.' });
    });
});

// PUT: Jefe asigna el trabajo (pone horas, fechas y detalles) o rechaza la solicitud
app.put('/api/trabajos/:id/asignar', (req, res) => {
    const { id } = req.params;
    const { estado, titulo, descripcion, horas_a_sumar, fecha_entrega, comentario_jefe, prestador_solicitante } = req.body;

    if (estado === 'Rechazado') {
        const query = 'UPDATE trabajos_especiales SET estado = "Rechazado", comentario_jefe = ? WHERE id = ?';
        db.query(query, [comentario_jefe, id], (err) => {
            if (err) return res.status(500).json({ success: false });
            // Mandar notificación de rechazo
            db.query('INSERT INTO notificaciones (usuario_nombre, mensaje) VALUES (?, ?)', [prestador_solicitante, `Tu solicitud de trabajo especial fue rechazada. Motivo: ${comentario_jefe}`]);
            return res.json({ success: true, message: 'Solicitud rechazada.' });
        });
    } else {
        const query = 'UPDATE trabajos_especiales SET estado = "Asignado", titulo = ?, descripcion = ?, horas_a_sumar = ?, fecha_asignacion = NOW(), fecha_entrega = ? WHERE id = ?';
        db.query(query, [titulo, descripcion, horas_a_sumar, fecha_entrega, id], (err) => {
            if (err) return res.status(500).json({ success: false });
            // Mandar notificación de asignación
            db.query('INSERT INTO notificaciones (usuario_nombre, mensaje) VALUES (?, ?)', [prestador_solicitante, `Se te ha asignado el trabajo especial: "${titulo}". Tienes hasta el ${fecha_entrega} para entregarlo.`]);
            res.json({ success: true, message: 'Trabajo asignado correctamente.' });
        });
    }
});

// PUT: Prestador sube su archivo (Entrega del trabajo) - Reutilizamos tu Multer que ya acepta PDFs y Docs
app.put('/api/trabajos/:id/entregar', upload.single('archivo'), (req, res) => {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ success: false, message: 'Falta el archivo PDF o Word.' });
    
    const archivo_trabajo = req.file.filename;
    const query = 'UPDATE trabajos_especiales SET estado = "Entregado", archivo_trabajo = ? WHERE id = ?';
    
    db.query(query, [archivo_trabajo, id], (err) => {
        if (err) return res.status(500).json({ success: false });
        res.json({ success: true, message: 'Trabajo entregado para revisión del Jefe.' });
    });
});

// PUT: Jefe revisa el archivo entregado y decide Aprobar (Suma horas) o Rechazar
app.put('/api/trabajos/:id/evaluar', (req, res) => {
    const { id } = req.params;
    const { estado, comentario_jefe, horas_a_sumar, prestador_solicitante } = req.body;

    const query = 'UPDATE trabajos_especiales SET estado = ?, comentario_jefe = ? WHERE id = ?';
    
    db.query(query, [estado, comentario_jefe, id], (err) => {
        if (err) return res.status(500).json({ success: false });

        if (estado === 'Aprobado') {
            // ¡MAGIA! Sumarle las horas al prestador en su tabla
            const queryHoras = 'UPDATE usuarios SET horas_adicionales = IFNULL(horas_adicionales, 0) + ? WHERE nombre = ?';
            db.query(queryHoras, [horas_a_sumar, prestador_solicitante], (err2) => {
                if (err2) return res.status(500).json({ success: false, message: 'Se aprobó pero hubo error sumando horas.' });
                
                // Notificación de éxito
                const mensaje = `🌟 ¡Felicidades! Tu trabajo especial fue aprobado. Se te sumaron ${horas_a_sumar} hora(s) a tu servicio.`;
                db.query('INSERT INTO notificaciones (usuario_nombre, mensaje) VALUES (?, ?)', [prestador_solicitante, mensaje]);
                
                return res.json({ success: true, message: 'Trabajo aprobado y horas sumadas al prestador.' });
            });
        } else {
            // Notificación de que entregó algo mal
            const mensaje = `❌ Tu trabajo especial entregado fue rechazado. Motivo: ${comentario_jefe}`;
            db.query('INSERT INTO notificaciones (usuario_nombre, mensaje) VALUES (?, ?)', [prestador_solicitante, mensaje]);
            return res.json({ success: true, message: 'Trabajo rechazado.' });
        }
    });
});

// --- INICIAR SERVIDOR ---
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});