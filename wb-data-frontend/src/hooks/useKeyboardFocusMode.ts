import { useEffect } from 'react';

const INPUT_MODALITY_ATTR = 'data-input-modality';

function isKeyboardNavigationKey(event: KeyboardEvent) {
    return event.key === 'Tab' || event.key.startsWith('Arrow');
}

export function useKeyboardFocusMode() {
    useEffect(() => {
        const root = document.documentElement;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isKeyboardNavigationKey(event)) return;
            root.setAttribute(INPUT_MODALITY_ATTR, 'keyboard');
        };

        const handlePointerInput = () => {
            root.setAttribute(INPUT_MODALITY_ATTR, 'pointer');
        };

        handlePointerInput();

        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('mousedown', handlePointerInput, true);
        document.addEventListener('pointerdown', handlePointerInput, true);
        document.addEventListener('touchstart', handlePointerInput, true);

        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('mousedown', handlePointerInput, true);
            document.removeEventListener('pointerdown', handlePointerInput, true);
            document.removeEventListener('touchstart', handlePointerInput, true);
        };
    }, []);
}
