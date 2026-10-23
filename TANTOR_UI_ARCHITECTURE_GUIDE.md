# Tantor UI — Master Architecture & Technical Deep-Dive

Welcome to the definitive architectural guide for **Tantor UI** (`tantor-ui`). This document breaks down the entire application from top-level system topology down to component-level state machines, explaining how data flows, how dashboarding works, how network requests are proxied and secured, and how the UI orchestrates enterprise Kafka clusters alongside AI-driven VAPT remediation.

---

## Table of Contents
1. [High-Level Architecture & Tech Stack](#1-high-level-architecture--tech-stack)
2. [Dual Backend Topology & Network Proxying](#2-dual-backend-topology--network-proxying)
3. [Authentication, Security & RBAC Pipeline](#3-authentication-security--rbac-pipeline)
4. [Application Lifecycle & Routing Architecture](#4-application-lifecycle--routing-architecture)
5. [Deep Dive: The Dashboard Engine (`Dashboard.tsx`)](#5-deep-dive-the-dashboard-engine)
6. [Backend Communication & API Contract](#6-backend-communication--api-contract)
7. [AI-OPS: VAPT Remediation & AgentMesh Pipeline (`VaptApp.jsx`)](#7-ai-ops-vapt-remediation--agentmesh-pipeline)
8. [Kafka Cluster Lifecycle & Deployment Engine (`ClusterDeployment.tsx`)](#8-kafka-cluster-lifecycle--deployment-engine)
9. [Subsystems: Monitoring, Artifacts, Auditing & Jobs](#9-subsystems-monitoring-artifacts-auditing--jobs)
10. [Expert Developer Cheatsheet](#10-expert-developer-cheatsheet)

---

## 1. High-Level Architecture & Tech Stack

Tantor UI is a modern, high-performance Single Page Application (SPA) built for enterprise data platform management and security operations.

```
┌────────────────────────────────────────────────────────────────────────┐
│                              Tantor UI                                 │
│                   React 19 + TypeScript + Vite 8                       │
├────────────────────────────────────────────────────────────────────────┤
│  Routing: React Router DOM v7 (Nested routes & lazy tab execution)    │
│  Design System: CSS Variables + Vanilla CSS + Glassmorphism           │
│  Visualizations: Recharts (Donuts, Stacked Area, Vertical Bar Charts)  │
│  Icons: Lucide-react                                                  │
│  Identity: Keycloak-js (PKCE S256 OAuth2/OIDC)                         │
│  Streaming: Server-Sent Events (SSE) via Web Streams API              │
└───────────────┬────────────────────────────────────────┬───────────────┘
                │ Proxy (/api)                           │ Direct (:8000)
                ▼                                        ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│     Tantor Control Plane      │        │       AgentMesh AI Engine     │
│  (Spring Boot / Java Core)    │        │      (FastAPI / Python Core)  │
│  - Port 8443 (Management API) │        │  - Port 8000 (Workflow/LLM)   │
│  - Port 8081 (Artifact Repo)  │        │  - Jev Engine & SSH Tools     │
└───────────────────────────────┘        └───────────────────────────────┘
```

### Core Dependencies Breakdown
- **React 19 (`react`, `react-dom`)**: Modern React with concurrent features and hooks (`useMemo`, `useCallback`, `useRef`).
- **Vite 8**: Build tool and dev server featuring Hot Module Replacement (HMR) and reverse proxy configurations.
- **Keycloak-js (v26)**: Handles Authorization Code Flow with PKCE without storing client secrets in browser memory.
- **Recharts (v3)**: SVG charting engine powering host disk utilization, cluster health donuts, and task activity timelines.
- **Lucide React**: Vector icons for dashboards, topology nodes, and status indicators.
- **Papaparse & SheetJS (xlsx)**: Client-side parsing for CSV configuration templates and Excel report imports.
- **React Markdown + Remark-GFM + Rehype-Raw**: Renders LLM responses and remediation advisories with code blocks and tables.

---

## 2. Dual Backend Topology & Network Proxying

One of the most important architectural aspects of Tantor UI is that **it communicates with two distinct backends**:

### 1. Tantor Enterprise Control Plane (Kafka Infrastructure & Management)
* **Backend Technology**: Spring Boot / Java.
* **Target Ports**: `http://localhost:8443` (API) & `http://localhost:8081` (Artifact Store).
* **Communication Route**: Proxied transparently via the Vite development server.

```typescript
// vite.config.ts
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8443'
  const artifactTarget = env.VITE_ARTIFACT_PROXY_TARGET || 'http://localhost:8081'

  return {
    server: {
      proxy: {
        '/api/v1/artifacts': {
          target: artifactTarget,
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
```
Any frontend request directed to `/api/v1/ui/clusters` is forwarded by Vite to `http://localhost:8443/api/v1/ui/clusters`. This prevents Cross-Origin Resource Sharing (CORS) issues in development. In production, this same reverse proxy is executed by Nginx (`nginx.conf`).

### 2. AgentMesh AI-OPS Engine (VAPT & Remediation)
* **Backend Technology**: FastAPI / Python (located in `Downloads/Backend`).
* **Target Port**: `http://localhost:8000`.
* **Communication Route**: Direct HTTP & SSE connection to `http://localhost:8000/api/v1/agentmesh/...`.
* **Purpose**: Orchestrates automated security workflows, LLM validation of scan documents, and real-time mitigation execution over SSH.

---

## 3. Authentication, Security & RBAC Pipeline

Security in Tantor UI is unified through `KeycloakService.ts` and `AuthContext.tsx`.

### Global Fetch Monkey-Patching (`installAuthenticatedFetch`)
Rather than manually wrapping every individual network call or writing Axios interceptors for every page, Tantor UI patches the browser's native `window.fetch`:

```typescript
// KeycloakService.ts
export const installAuthenticatedFetch = () => {
  if (!isAuthEnabled() || authenticatedFetchInstalled) return;

  nativeFetch = window.fetch.bind(window);
  authenticatedFetchInstalled = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url || input.toString(), window.location.origin);
    const headers = new Headers(init?.headers || request?.headers);

    // If calling any local /api/ endpoint, auto-attach Bearer Token
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      const token = await getValidToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    return nativeFetch!(input, { ...init, headers });
  };
};
```

#### Why this is powerful:
1. **Zero boilerplate**: Any component can write `fetch('/api/v1/ui/hosts')` and it is instantly secured with Keycloak SSO tokens.
2. **Auto-refresh**: `getValidToken()` calls `keycloak.updateToken(30)`. If the access token expires within 30 seconds, it refreshes automatically before the network request leaves the browser.
3. **Background Heartbeat**: A 30-second interval in `AuthContext` periodically refreshes credentials in the background.
4. **Dev Mode Bypass**: If `VITE_AUTH_ENABLED=false`, SSO is bypassed and a mock user (`VITE_DEV_USER=shaukat`, `role=admin`) is supplied automatically.

### Role-Based Access Control (`usePermissions`)
The `usePermissions.ts` hook unpacks decoded JWT claims:
* **Admin**: Possesses full administrative rights (`isAdmin: true`, `canManage: true`). Can trigger cluster deployments, node restarts, delete operations, user management, and LDAP configuration.
* **Monitor / Viewer**: Read-only user (`isMonitor: true`, `canManage: false`). Can view dashboards, metrics, and logs, but action buttons (e.g., "New Cluster", "Delete", "Rolling Restart") are hidden or disabled.

---

## 4. Application Lifecycle & Routing Architecture

When a user visits Tantor UI, the bootstrap sequence is as follows:

```
[index.html] -> Mounts root
      │
      ▼
[main.tsx] -> Wraps root in <StrictMode> and <AuthProvider>
      │
      ▼
[AuthProvider] -> Initializes Keycloak SSO (or dev fallback)
      │
      ├── (If initializing) -> Displays "Connecting to Tantor SSO..."
      │
      ▼
[ClusterProvider] -> Pre-fetches /api/v1/ui/clusters and sets activeClusterId
      │
      ▼
[App.tsx] -> Mounts <Router>, <TopNavbar />, <Sidebar />, and <Routes>
```

### Route Structure
* `/dashboard`: System overview, KPI cards, Recharts visualizations.
* `/hosts`: Managed host fleet, agent heartbeats, node enrollment, prerequisite diagnostics.
* `/clusters`: All deployed clusters with health status and rolling restart controls.
* `/clusters/:id/*`: Nested routing for single cluster operations:
  - `overview`: Cluster telemetry, node topology, Kafka cluster ID.
  - `nodes`: Host and node mapping.
  - `brokers`: Individual broker configurations, listeners, and ports.
  - `topics` & `topics/:topicName`: Topic partition metrics, message browser, producer, ACLs.
  - `partitions`: Low/high watermarks and replica synchronization.
  - `consumers`: Consumer group lag and member states.
  - `config`: Live broker & cluster property editor with historical version diffing.
  - `actions`: Rolling restarts, task rollbacks, cleanup procedures.
  - `logs`: Live streaming deployment and agent execution logs.
  - `schema-registry` & `kafka-connect`: Integrated Schema Registry and Kafka Connectors management.
* `/artifacts`: Parcels, Kafka binaries, distribution and activation across VM fleets.
* `/jobs` & `/jobs/:id`: Asynchronous execution engine status and step-by-step progress.
* `/monitoring`: Prometheus metrics, JVM heap, network I/O, CPU trends.
* `/alerts`: Active platform incidents and alert rules.
* `/audit`: Immutable audit logs with resource filtering.
* `/ai-ops/vapt`: AI-driven Vulnerability Assessment & Penetration Testing remediation.
* `/ai-ops/automation`: OCI infrastructure automation assistant.

---

## 5. Deep Dive: The Dashboard Engine (`Dashboard.tsx`)

The dashboard is the central nerve center of Tantor UI. It aggregates infrastructure health across hosts, clusters, background jobs, and system daemons.

### 1. The Data Ingestion Cycle
Upon component mount, `Dashboard.tsx` makes a single request:
```typescript
const res = await fetch('/api/v1/ui/dashboard');
const data: DashboardPayload = await res.json();
```

### 2. The Dashboard Payload Contract
```typescript
interface DashboardPayload {
  generatedAt: string;          // ISO timestamp of server snapshot
  summary: DashboardSummary;    // Aggregated KPI counts
  hostStatus: ChartRow[];       // Fleet online/offline breakdown
  clusterStatus: ChartRow[];    // Cluster success/degraded breakdown
  clusterHealth: ClusterHealthRow[]; // Array of cluster status cards
  hostDiskUsage: ChartRow[];    // Disk usage per host (from heartbeat)
  taskStatus: ChartRow[];       // Task distribution
  taskTimeline: ChartRow[];     // 7-day chronological history
  runningServices: ServiceRow[];// Active platform services
  failedServices: ServiceRow[]; // Failed platform services
  recentActivities: ActivityRow[]; // Audit events
  recentTasks: TaskRow[];       // Asynchronous task records
}
```

### 3. Visual Components & Chart Rendering

#### A. KPI Metric Header Cards
Displays top-level platform counters with dynamic coloring based on warning thresholds:
- **Active Hosts**: Highlights red (`tone: 'bad'`) if `offlineHosts > 0`.
- **Clusters**: Counts managed clusters, highlighting if any are degraded.
- **External Clusters**: Displays discovered or externally registered Kafka clusters.
- **Running / Failed Services**: Tracks underlying cluster processes.

#### B. Cluster Health Strip
Renders interactive cluster status cards showing:
- Cluster name, source (`INTERNAL` vs `EXTERNAL`), and Kafka version.
- Node count and human-readable health reasons (`cluster.reason`).
- Clicking any card executes `navigate('/clusters/' + cluster.id)`.

#### C. Host Disk Usage Bar Chart
Renders a Recharts `<BarChart>` oriented vertically:
```tsx
<BarChart data={dashboard.hostDiskUsage} layout="vertical">
  <CartesianGrid stroke="#eeeae3" horizontal={false} />
  <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} />
  <YAxis dataKey="name" type="category" width={132} />
  <Tooltip content={<DiskTooltip />} />
  <Bar dataKey="usedPct" fill="#378ADD" radius={[0, 6, 6, 0]} />
</BarChart>
```
The custom `<DiskTooltip />` extracts `usedGb`, `totalGb`, and `freeGb` from the payload to show concrete disk metrics on hover.

#### D. Status Donuts (`StatusDonut`)
Displays fleet distributions using Recharts `<PieChart>` with custom inner/outer radius for donut styling (`innerRadius={54}`, `outerRadius={78}`). Colors are mapped via `STATUS_COLORS`:
- `SUCCESS` / `ONLINE`: `#36AD8F` (Emerald Green)
- `RUNNING` / `IN_PROGRESS`: `#378ADD` (Sky Blue)
- `PENDING` / `DELETING`: `#BA7517` (Amber)
- `OFFLINE` / `FAILED`: `#A32D2D` (Crimson)

#### E. 7-Day Task Activity Area Chart
Visualizes historical platform workload via a multi-series stacked `<AreaChart>`:
- Green area: Successful tasks (`success`)
- Blue area: In-progress tasks (`running`)
- Red area: Failed tasks (`failed`)

---

## 6. Backend Communication & API Contract

Tantor UI utilizes two communication paradigms: **Synchronous REST** and **Asynchronous Polling & SSE**.

### A. Synchronous REST Patterns
Used for immediate CRUD operations:
- `GET /api/v1/ui/clusters`: List all clusters.
- `GET /api/v1/ui/hosts`: Retrieve host inventory and agent statuses.
- `DELETE /api/v1/ui/clusters/{id}`: Delete a cluster.
- `GET /api/v1/clusters/{id}/topics`: Fetch paginated topics.

### B. Asynchronous Job & Task Pattern
Deployments, host diagnostics, and rolling restarts cannot complete within a single HTTP request timeout. Tantor UI handles this through task polling:

```
[UI] ──── POST /api/v1/ui/hosts/{id}/check-prerequisites ───► [Backend]
[UI] ◄─── HTTP 202 Accepted { taskId: "tsk-9821" } ───────── [Backend]
  │
  ├─► [UI starts polling loop: every 1000ms]
  │
  ├───► GET /api/v1/ui/hosts/{id}/check-prerequisites/tsk-9821
  ◄──── { status: "RUNNING", logOutput: "Checking port 9092..." }
  │
  ├───► GET /api/v1/ui/hosts/{id}/check-prerequisites/tsk-9821
  ◄──── { status: "SUCCESS", logOutput: "All ports open. Kernel OK." }
  │
[UI updates State: status = 'SUCCESS']
```

---

## 7. AI-OPS: VAPT Remediation & AgentMesh Pipeline (`VaptApp.jsx`)

The VAPT subsystem is a full-featured AI Security Analyst embedded within Tantor UI. It is built to ingest real-world vulnerability scan reports (Nessus, Qualys, OpenVAS in CSV or Excel format), validate report authenticity, categorize vulnerabilities into domains, and stream AI-generated remediation commands.

### Architecture of VAPT Execution

```
[User uploads report.xlsx]
            │
            ▼
1. POST /api/v1/agentmesh/execution/upload-artifact
   └─► Returns { artifact_id: "art-123" }
            │
            ▼
2. POST /api/v1/agentmesh/workflow/{WORKFLOW_ID}/execute (mode: 'run')
   └─► Initializes session state in AgentMesh on thread_id
            │
            ▼
3. POST /api/v1/agentmesh/workflow/{WORKFLOW_ID}/execute (mode: 'resume')
   └─► Passes { artifact_id, filename } to trigger Jev validation node
            │
            ▼
4. GET /api/v1/agentmesh/vapt/findings/{threadId}
   └─► Retrieves AI-classified findings from Jev Engine
            │
    ┌───────┴───────────────────────────────┐
    ▼                                       ▼
[is_vapt === false]                 [is_vapt === true]
- Resets metrics to zero            - Populates Severity Counts (s0-s4)
- Displays Non-VAPT dialog          - Populates PTS Donut Chart
- Shows warning in chat             - Populates Categorized Vulnerabilities
                                      (OS, Network, Database, Application)
```

### Server-Sent Events (SSE) Streaming Engine
When the user converses with the AI Analyst, `VaptApp.jsx` handles live streaming via the native `ReadableStream` API:

```javascript
const response = await fetch(`${API_BASE}/api/v1/agentmesh/workflow/${WORKFLOW_ID}/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'stream', thread_id: threadId, input: text })
});

const reader = response.body.getReader();
const decoder = new TextDecoder('utf-8');
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const event = JSON.parse(line.replace(/^data:\s*/, ''));

    if (event.type === 'token') {
      // Append real-time token to message bubble
      accumulatedContent += event.content;
      updateAgentMessage(accumulatedContent);
    } else if (event.type === 'tool_call') {
      // Show tool banner (e.g. "Analyzing VAPT Scan Findings...")
      setActiveToolName(event.tool);
    } else if (event.type === 'tool_result') {
      setActiveToolName(null);
    } else if (event.type === 'final') {
      finishStreaming(event.content);
    }
  }
}
```

### Local Storage Session Persistence
The VAPT session is preserved across page refreshes using key-prefixed localStorage entries:
- `vapt_state_thread_id`: Preserves the active workflow thread.
- `vapt_state_pts_data` & `vapt_state_severity_counts`: Preserves charts.
- `vapt_state_vulnerabilities`: Preserves classified findings.
- `vapt_state_messages`: Preserves remediation chat history.

---

## 8. Kafka Cluster Lifecycle & Deployment Engine (`ClusterDeployment.tsx`)

`ClusterDeployment.tsx` is one of the most comprehensive modules in Tantor UI (over 1,800 lines of code). It manages the entire lifecycle of provisioning enterprise Apache Kafka clusters.

### Supported Deployment Topologies
1. **KRaft Mode (Kafka 3.x & 4.x)**:
   - Dedicated Controllers + Dedicated Brokers (`separate`).
   - Combined Broker & Controller (`broker_controller`).
   - Pure Brokers (`broker`).
   - Topology validator ensures quorum requirements (odd number of controllers, valid quorum voter configurations).
2. **ZooKeeper Mode (Kafka 3.x only)**:
   - ZooKeeper Quorum (`zookeeper` role).
   - Dedicated Brokers (`broker`).
   - Combined Broker + ZooKeeper (`broker_zookeeper`).
   - Automatically disabled if Kafka 4.x is selected (since ZooKeeper was removed in Kafka 4.0).

### Deployment Flow Stages

```
┌────────────────────────────────────────────────────────┐
│ Stage 1: Details & Topology Specification              │
│ - Select Kafka Version (loaded from Artifact Store)    │
│ - Select Deployment Mode (KRaft vs ZooKeeper)          │
│ - Select Managed Hosts from Inventory                  │
│ - Assign Service Roles per Host                        │
│ - Configure Listener, Controller, & Peer Ports         │
│ - Set Partition & Replication Defaults                 │
└──────────────────────────┬─────────────────────────────┘
                           │ Click "Preview Deployment"
                           ▼
┌────────────────────────────────────────────────────────┐
│ Stage 2: Verification, Diagnostics & Execution         │
│ - KRaft Topology Validation (/validate-kraft)          │
│ - Host Prerequisite Checks (/check-prerequisites)       │
│     * OS kernel parameters (sysctl)                    │
│     * SELinux & Firewall configuration                 │
│     * Port availability testing                        │
│ - Automatic Host Remediation (/fix-prerequisites)      │
│ - Remote Reboot Support (/reboot)                      │
│ - Final Deployment Dispatch (/deploy)                  │
└──────────────────────────┬─────────────────────────────┘
                           │ Redirects to
                           ▼
┌────────────────────────────────────────────────────────┐
│ Job Execution & Deployment Logs View                   │
│ - Real-time step progress (/jobs/:id or /clusters/:id) │
└────────────────────────────────────────────────────────┘
```

---

## 9. Subsystems: Monitoring, Artifacts, Auditing & Jobs

### Monitoring (`Monitoring.tsx`)
- Queries Prometheus backend via `/api/v1/monitoring/clusters/{id}/overview`.
- Polls Kafka Exporter & JMX metrics:
  - Messages in/sec, Bytes in/sec, Bytes out/sec.
  - Under-replicated partitions & Consumer lag.
  - JVM Heap utilization & Host CPU/Memory percentages.
- Tracks real-time historical graphs with auto-refresh timers.

### Artifacts & Parcels (`Artifacts.tsx`)
- Acts as a local repository for Kafka binaries and service parcels.
- Allows uploading new tarball releases (`/api/v1/artifacts`).
- Manages Parcel Distribution lifecycle:
  `Distribute -> Unpack -> Activate -> Deactivate -> Remove`.

### Audit Logs (`AuditLogs.tsx`)
- Queries `/api/v1/ui/audit?size=500`.
- Provides an enterprise audit trail recording who performed which action (`actor`, `action`, `resourceType`, `status`, `timestamp`).
- Features real-time client-side filtering by category (`CLUSTER`, `HOST`, `PACKAGE`, `AGENT`), date ranges, and status.

### Jobs & Asynchronous Execution (`JobsList.tsx` & `JobStatusPage.tsx`)
- Displays orchestrator jobs.
- Maps low-level internal automation scripts into human-readable business steps (e.g., mapping `Deploy broker_controller node 1` to `Provision Broker/Controller Node 1`).
- Provides support for manual step retries and task rollbacks.

---

## 10. Expert Developer Cheatsheet

### Key Files at a Glance
| File Path | Role & Purpose |
| :--- | :--- |
| `src/main.tsx` | Root bootstrap, mounts `AuthProvider` & `App`. |
| `src/App.tsx` | Main routing table, defines all top-level and nested cluster routes. |
| `src/services/KeycloakService.ts` | Keycloak client configuration and `window.fetch` token interceptor. |
| `src/contexts/AuthContext.tsx` | SSO state management, session token decoder, token auto-refresh timer. |
| `src/contexts/ClusterContext.tsx` | Global cluster selector state, provides `activeClusterId`. |
| `src/hooks/usePermissions.ts` | Role derivation (`isAdmin`, `isMonitor`, `canManage`). |
| `src/pages/Dashboard.tsx` | Dashboard view, Recharts panels, KPI counters. |
| `src/pages/ClusterDeployment.tsx` | Full 2-stage Kafka provisioning wizard & prerequisite engine. |
| `src/pages/Vapt/VaptApp.jsx` | AI-OPS VAPT remediation engine, SSE stream reader, Jev findings sync. |
| `src/pages/ClusterDetails.tsx` | Nested cluster dashboard shell with sub-tabs. |
| `vite.config.ts` | Development proxy configuration for `:8443` and `:8081`. |

### Crucial Architectural Rules to Remember
1. **Never hardcode Keycloak tokens**: Rely on `fetch('/api/...')` — the patched fetch automatically handles token attachment and renewal.
2. **Use Vite Proxy for Tantor APIs**: Always use relative URLs like `/api/v1/...` so Vite forwards them to `:8443` or `:8081`.
3. **AgentMesh APIs use Port 8000**: VAPT and Automation endpoints currently hit `http://localhost:8000/api/v1/agentmesh/...`.
4. **Respect RBAC**: Check `const { canManage } = usePermissions();` before showing destructive UI triggers (deleting clusters, restarting nodes, rolling back tasks).
5. **Handle Long-Running Actions via Polling**: Backend operations return a `taskId` or `jobId`; always poll the task status until it transitions out of `RUNNING` or `QUEUED`.
