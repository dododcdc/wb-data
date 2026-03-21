interface TopProgressBarProps {
    visible: boolean;
    settling?: boolean;
}

export function TopProgressBar(props: TopProgressBarProps) {
    const { visible, settling = false } = props;

    return (
        <div
            aria-hidden="true"
            className={`layout-progress-shell ${visible ? 'visible' : ''} ${settling ? 'settling' : ''}`.trim()}
        >
            <span className="layout-progress-bar" />
        </div>
    );
}
