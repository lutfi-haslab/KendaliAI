import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f0f0f' }}>
      <Outlet />
    </div>
  ),
})
