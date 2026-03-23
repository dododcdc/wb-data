export const VITE_PRELOAD_RELOAD_KEY = 'vite-preload-reloaded'

export function isDynamicImportPreloadError(message: string) {
    return (
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Outdated Optimize Dep')
    )
}

export function recoverFromVitePreloadError() {
    if (!import.meta.env.DEV) {
        return false
    }

    const hasReloaded = sessionStorage.getItem(VITE_PRELOAD_RELOAD_KEY) === 'true'
    if (hasReloaded) {
        sessionStorage.removeItem(VITE_PRELOAD_RELOAD_KEY)
        return false
    }

    sessionStorage.setItem(VITE_PRELOAD_RELOAD_KEY, 'true')
    window.location.reload()
    return true
}
