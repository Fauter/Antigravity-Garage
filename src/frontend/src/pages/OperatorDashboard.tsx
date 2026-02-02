import React from 'react';
import EntryPanel from '../components/access/EntryPanel';
import PanelSalida from '../components/access/PanelSalida';

const OperatorDashboard: React.FC = () => {
    return (
        <div className="flex w-full h-full">
            {/* Left Column: Entry (40%) */}
            <section className="w-[35%] xl:w-[30%] h-full flex flex-col relative z-20 shadow-xl shadow-black/50">
                <EntryPanel />
            </section>

            {/* Right Column: Exit & Stays (60%) */}
            <section className="flex-1 h-full bg-gray-950 flex flex-col relative">
                <PanelSalida />
            </section>
        </div>
    );
};

export default OperatorDashboard;
