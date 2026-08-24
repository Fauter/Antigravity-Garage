export interface LastDaysEligibility {
    currentDay: number;
    daysInMonth: number;
    remainingCalendarDays: number;
    isLastTwoDays: boolean;
}

/**
 * Calculates whether a given date falls within the last two days of its month.
 */
export function getLastTwoDaysEligibility(currentDate: Date): LastDaysEligibility {
    if (!(currentDate instanceof Date) || isNaN(currentDate.getTime())) {
        return {
            currentDay: 0,
            daysInMonth: 0,
            remainingCalendarDays: 0,
            isLastTwoDays: false
        };
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const currentDay = currentDate.getDate();

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const remainingCalendarDays = daysInMonth - currentDay + 1;
    
    // Check if it's the last or second to last day
    const isLastTwoDays = remainingCalendarDays <= 2 && remainingCalendarDays >= 1;

    return {
        currentDay,
        daysInMonth,
        remainingCalendarDays,
        isLastTwoDays
    };
}
