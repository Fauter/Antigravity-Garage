interface PrinterConfig {
    deviceName?: string;
    pageWidth?: number; // en micrones: 58000 = 58mm, 80000 = 80mm, 210000 = A4
}

interface ElectronAPI {
    silentPrint: (html: string, printerConfig?: PrinterConfig) => Promise<{ success: boolean; error?: string }>;
    getPrinters: () => Promise<Array<{ name: string; isDefault: boolean; status?: number }>>;
}

interface Window {
    electronAPI?: ElectronAPI;
}
