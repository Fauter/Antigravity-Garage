import React from 'react';
import ReactDOM from 'react-dom';

interface ModalPortalProps {
    children: React.ReactNode;
}

export const ModalPortal: React.FC<ModalPortalProps> = ({ children }) => {
    if (typeof document === 'undefined') {
        return null;
    }
    return ReactDOM.createPortal(children, document.body);
};
