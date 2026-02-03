export interface PriceMatrix {
    [vehicleType: string]: {
        [tariffName: string]: number;
    };
}

export interface IPriceMatrixRepository {
    getPrices(paymentMethod: 'efectivo' | 'otros'): Promise<PriceMatrix>;
    updatePrices(paymentMethod: 'efectivo' | 'otros', vehicleType: string, prices: { [tariffName: string]: number }): Promise<void>;
}
