import './OperationsCenter.css';

export default function OperationsCenter() {
    return (
        <div className="operations-center-page animate-enter">
            <header className="operations-center-header">
                <h1>运维中心</h1>
            </header>

            <section className="operations-center-shell" aria-label="运行记录">
                <div className="operations-center-table-head" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                </div>
                <div className="operations-center-rows" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, index) => (
                        <div className="operations-center-row" key={index}>
                            <span />
                            <span />
                            <span />
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
