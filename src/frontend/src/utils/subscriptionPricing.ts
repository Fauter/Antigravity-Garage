export interface SubscriptionPricingParams {
    monthlyPrice: number;
    currentDate: Date;
    fullPriceEnabled: boolean;
    fullPriceUntilDay: number | null;
}

export interface SubscriptionPricingResult {
    monthlyPrice: number;
    totalInitial: number;
    remainingDays: number;
    daysInMonth: number;
    currentDay: number;
    isFullMonthCharge: boolean;
    isProratedCharge: boolean;
}

export function calculateInitialSubscriptionAmount({
    monthlyPrice,
    currentDate,
    fullPriceEnabled,
    fullPriceUntilDay
}: SubscriptionPricingParams): SubscriptionPricingResult {
    const currentDay = currentDate.getDate();
    
    // Validate defensive parameters
    const safeMonthlyPrice = (typeof monthlyPrice !== 'number' || !Number.isFinite(monthlyPrice) || monthlyPrice < 0) ? 0 : monthlyPrice;

    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();

    const validUntilDay =
        typeof fullPriceUntilDay === 'number' &&
        Number.isInteger(fullPriceUntilDay) &&
        fullPriceUntilDay >= 1 &&
        fullPriceUntilDay <= 31;

    const isFullMonthCharge =
        fullPriceEnabled === true &&
        validUntilDay &&
        currentDay <= (fullPriceUntilDay as number);

    const remainingDays = daysInMonth - currentDay + 1;
    
    let totalInitial = 0;
    if (isFullMonthCharge) {
        totalInitial = safeMonthlyPrice;
    } else {
        totalInitial = Math.round((safeMonthlyPrice / daysInMonth) * remainingDays);
    }

    // Defensive NaN check on totalInitial just in case
    if (Number.isNaN(totalInitial) || !Number.isFinite(totalInitial)) {
        totalInitial = 0;
    }

    return {
        monthlyPrice: safeMonthlyPrice,
        totalInitial,
        remainingDays,
        daysInMonth,
        currentDay,
        isFullMonthCharge,
        isProratedCharge: !isFullMonthCharge
    };
}
