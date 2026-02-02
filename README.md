Antigravity Garage - Reconstrucción 2.0

Este documento es la referencia absoluta para el desarrollo del sistema, diseñado bajo arquitectura Offline-First y Feature-First.
1. Identificación de 'Deuda Técnica' y Soluciones
Deuda Técnica Detectada (Código Viejo)	Solución Profesional (Nueva Arquitectura)
Sincronización Artesanal	Sync Engine + MutationQueue. El sistema registra cada acción localmente y las sincroniza mediante un Reconciliation Log.
Sanitización de IDs	Zod + UUID v4. Validación estricta en la entrada. IDs generados en el cliente para soporte offline sin colisiones.
Lógica de Precios Duplicada	Shared Logic. El PricingEngine es la única fuente de verdad para el cálculo de tarifas.
Global Mutable State	Atomic Counters. Manejo de secuencias de tickets mediante operaciones atómicas en la base de datos.
Dependencia de Scripts Python	Hardware Adapter Service. Uso de librerías nativas de Node/Electron para cámaras e impresoras térmicas.
2. Reglas de Negocio (Dominio Puro)
💰 Tarifación y Cobros

    Diferenciación de Precios: El sistema debe soportar precios distintos según el método de pago (Efectivo vs. Otros métodos como QR, Débito, etc.).

    Selección de Tarifa: No hay jerarquía; el precio se toma directamente según el tipo de suscripción (Exclusiva, Fija, Móvil) y el método de pago elegido.

    Prorrateo: (precioBase / diasMes) * diasRestantes para altas realizadas a mitad de mes.

    Mora: * Día 1-10: Precio base.

        Día 11-21: Recargo Nivel 1.

        Día 22+: Recargo Nivel 2.

🚗 Estacionamiento vs. Movimientos

    Stay (Estancia): Es el registro físico de un vehículo. La entrada NO genera un movimiento financiero.

    Movement (Movimiento): Es estrictamente un evento financiero (Cobro). Se crea al cobrar abonos, renovaciones o la salida de un vehículo.

    Cocheras Móviles: Nunca se reutilizan; cada alta genera una nueva instancia lógica.

3. Interfaz y Experiencia (UI/UX)

El frontend debe rescatar la usabilidad de la versión anterior mediante una disposición de elementos optimizada para el operador:

    Header: Navegación por pestañas (Operador, Auditoría, Abono, Cierre, etc.).

    Visualización: Dos monitores superiores de gran tamaño para cámaras RTSP.

    Panel de Entrada (Izquierda): Formulario verde para patente y tipo de vehículo.

    Panel de Pago (Centro): Selector de métodos de pago, display de precio gigante y botón SALIDA en azul.

    Facturación (Derecha): Selector rápido de tipo de comprobante (CC, A, Final).

4. Arquitectura del Sistema
Plaintext

src/
├── modules/
│   ├── AccessControl/      # Gestión de Estancias (Stays), Entradas y Salidas
│   ├── Billing/            # Caja, Movimientos Financieros y PricingEngine
│   ├── Garage/             # Gestión de Cocheras, Clientes y Abonos
│   ├── Identity/           # Autenticación y Usuarios
│   └── Sync/               # Motor Offline-First y MutationQueue
├── shared/                 # Zod Schemas y Tipos compartidos
└── infrastructure/         # DB (Mongo), Server (Express), WebSockets (Socket.io)