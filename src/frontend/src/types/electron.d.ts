interface ElectronAPI {
    silentPrint: (html: string) => Promise<{ success: boolean; error?: string }>;
    getPrinters: () => Promise<Array<{ name: string; isDefault: boolean; status?: number }>>;
}

interface Window {
    electronAPI?: ElectronAPI;
}
