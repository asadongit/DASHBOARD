import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8443'
  const artifactTarget = env.VITE_ARTIFACT_PROXY_TARGET || 'http://localhost:8081'
  const agentMeshTarget = env.VITE_AGENTMESH_URL || 'http://localhost:8000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/v1/artifacts': {
          target: artifactTarget,
          secure: false,
        },
        '/api/v1/agentmesh': {
          target: agentMeshTarget,
          secure: false,
        },
        '/api': {
          target: apiTarget,
          secure: false,
        },
      },
    },
  }
})
