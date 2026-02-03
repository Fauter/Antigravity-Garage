export interface SystemParams {
    fraccionarDesde: number;
    toleranciaInicial: number;
    recargoDia11: number;
    recargoDia22: number;
    permitirCobroAnticipado: boolean;
}

export interface IParamRepository {
    getParams(): Promise<SystemParams>;
    saveParams(params: Partial<SystemParams>): Promise<void>;
}
