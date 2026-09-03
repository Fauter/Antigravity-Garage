import { useEffect } from 'react';

export const useBodyScrollLock = (isLocked: boolean): void => {
    useEffect(() => {
        if (!isLocked || typeof document === 'undefined') return;

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [isLocked]);
};
