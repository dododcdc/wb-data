import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import router from './router'
import { isDynamicImportPreloadError, recoverFromVitePreloadError } from './utils/vitePreloadRecovery'
import './index.css'

const showReactQueryDevtools = import.meta.env.DEV && import.meta.env.VITE_ENABLE_QUERY_DEVTOOLS === 'true'

const ReactQueryDevtools = showReactQueryDevtools
  ? lazy(() => import('@tanstack/react-query-devtools').then((mod) => ({ default: mod.ReactQueryDevtools })))
  : null

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})

if (import.meta.env.DEV) {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    recoverFromVitePreloadError()
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      typeof reason === 'string'
        ? reason
        : reason instanceof Error
          ? reason.message
          : ''

    if (!isDynamicImportPreloadError(message)) {
      return
    }

    event.preventDefault()
    recoverFromVitePreloadError()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {ReactQueryDevtools ? (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  </StrictMode>,
)
