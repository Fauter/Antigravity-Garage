export interface Tariff {
    id: string;
    nombre: string;
    tipo: 'hora' | 'turno' | 'abono' | 'estadia';
    dias: number;
    horas: number;
    minutos: number;
    tolerancia: number;
}

export interface ITariffRepository {
    getAll(): Promise<Tariff[]>;
    save(tariff: Tariff): Promise<void>;
    update(id: string, tariff: Partial<Tariff>): Promise<void>;
    delete(id: string): Promise<void>;
}
