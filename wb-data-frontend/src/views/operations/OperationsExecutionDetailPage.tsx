import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import './OperationsExecutionDetailPage.css';

export default function OperationsExecutionDetailPage() {
    const navigate = useNavigate();
    const { executionId } = useParams<{ executionId: string }>();

    return (
        <div className="operations-execution-detail-page animate-enter">
            <header className="operations-execution-detail-header">
                <button
                    type="button"
                    className="operations-execution-detail-back"
                    onClick={() => navigate('/operations')}
                    aria-label="返回运维中心"
                >
                    <ArrowLeft size={17} />
                    <span>返回</span>
                </button>
                <div>
                    <h1>执行详情</h1>
                    {executionId && <p>{executionId}</p>}
                </div>
            </header>

            <section className="operations-execution-detail-shell" aria-label="执行详情">
                <div className="operations-execution-detail-summary" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </div>
                <div className="operations-execution-detail-body" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                </div>
            </section>
        </div>
    );
}
