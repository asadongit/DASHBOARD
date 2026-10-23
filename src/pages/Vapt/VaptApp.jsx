import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, Download, Send, Shield, Plus, MessageSquare, X, RefreshCw, 
  CheckCircle2, AlertTriangle, FileSpreadsheet, Terminal, 
  ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Copy, Check, Sparkles, Loader2 
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import './VaptApp.css';

const WORKFLOW_ID = 'c7f3b8a1-4e92-4f15-8d26-9a5c8e3f1b0a';
const API_BASE = 'http://localhost:8000';

function genThreadId() {
  return 'vapt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
}

// Server-side classification handled exclusively via AgentMesh & TypeSafe Jev Engine

function normalizeSeverityLabel(raw) {
  const s = String(raw || '').trim().toLowerCase().replace('.0', '');
  if (s === '4' || s === 'critical' || s === 'severe' || s === 's0' || s === '100') return 'Critical';
  if (s === '3' || s === 'high' || s === 'important' || s === 's1') return 'High';
  if (s === '2' || s === 'medium' || s === 'moderate' || s === 's2') return 'Medium';
  if (s === '1' || s === 'low' || s === 'minor' || s === 's3') return 'Low';
  const num = parseFloat(s);
  if (!isNaN(num)) {
    if (num >= 9.0) return 'Critical';
    if (num >= 7.0) return 'High';
    if (num >= 4.0) return 'Medium';
    if (num > 0) return 'Low';
  }
  return 'Info';
}

function ThinkingDots() {
  return (
    <span className="thinking-dots">
      <span /><span /><span />
    </span>
  );
}

const STORAGE_PREFIX = 'vapt_state_';

const STORAGE_KEYS = {
  THREAD_ID: `${STORAGE_PREFIX}thread_id`,
  UPLOADED_FILE_NAME: `${STORAGE_PREFIX}uploaded_file_name`,
  PTS_DATA: `${STORAGE_PREFIX}pts_data`,
  SEVERITY_COUNTS: `${STORAGE_PREFIX}severity_counts`,
  VULNERABILITIES: `${STORAGE_PREFIX}vulnerabilities`,
  CATEGORY_STATS: `${STORAGE_PREFIX}category_stats`,
  SELECTED_CATEGORY: `${STORAGE_PREFIX}selected_category`,
  MESSAGES: `${STORAGE_PREFIX}messages`,
  IS_CHAT_OPEN: `${STORAGE_PREFIX}is_chat_open`,
};

function safeGetStorage(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return defaultValue;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[VAPT Storage] Error reading ${key}:`, err);
    return defaultValue;
  }
}

function safeSetStorage(key, value) {
  try {
    if (value === undefined || value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (err) {
    console.warn(`[VAPT Storage] Error writing ${key}:`, err);
  }
}

const DEFAULT_PTS_DATA = [
  { name: 'Critical', value: 0, color: '#991b1b' },
  { name: 'High', value: 0, color: '#c2410c' },
  { name: 'Medium', value: 0, color: '#b45309' },
  { name: 'Low', value: 0, color: '#1e40af' },
  { name: 'Info', value: 0, color: '#047857' },
];

const DEFAULT_SEVERITY_COUNTS = { s0: 0, s1: 0, s2: 0, s3: 0, s4: 0 };

const DEFAULT_VULNERABILITIES = {
  'OS': [],
  'Network': [],
  'Database': [],
  'Application': [],
  'Other/General': []
};

export default function VaptApp() {
  const [threadId, setThreadId] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.THREAD_ID);
      if (saved) return saved;
    } catch (e) {}
    const newId = genThreadId();
    try {
      localStorage.setItem(STORAGE_KEYS.THREAD_ID, newId);
    } catch (e) {}
    return newId;
  });

  const [uploadedFileName, setUploadedFileName] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.UPLOADED_FILE_NAME) || null;
    } catch (e) {
      return null;
    }
  });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [nonVaptDialogue, setNonVaptDialogue] = useState(null);
  
  // Dashboard Metrics State (Persisted)
  const [ptsData, setPtsData] = useState(() => {
    return safeGetStorage(STORAGE_KEYS.PTS_DATA, DEFAULT_PTS_DATA);
  });

  const [severityCounts, setSeverityCounts] = useState(() => {
    return safeGetStorage(STORAGE_KEYS.SEVERITY_COUNTS, DEFAULT_SEVERITY_COUNTS);
  });

  const [vulnerabilities, setVulnerabilities] = useState(() => {
    return safeGetStorage(STORAGE_KEYS.VULNERABILITIES, DEFAULT_VULNERABILITIES);
  });

  const [selectedCategory, setSelectedCategory] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SELECTED_CATEGORY) || 'OS';
    } catch (e) {
      return 'OS';
    }
  });

  const [categoryStats, setCategoryStats] = useState(() => {
    return safeGetStorage(STORAGE_KEYS.CATEGORY_STATS, {});
  });

  // Table pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageRecords, setPageRecords] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCategoryRecords, setTotalCategoryRecords] = useState(0);
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [pageJumpInput, setPageJumpInput] = useState('');
  
  // Chat & Agent State (Persisted)
  const [messages, setMessages] = useState(() => {
    const saved = safeGetStorage(STORAGE_KEYS.MESSAGES, []);
    return Array.isArray(saved) 
      ? saved.map(m => m.isStreaming ? { ...m, isStreaming: false } : m)
      : [];
  });

  const [isChatOpen, setIsChatOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.IS_CHAT_OPEN);
      if (saved !== null) return saved === 'true';
    } catch (e) {}
    const savedMsgs = safeGetStorage(STORAGE_KEYS.MESSAGES, []);
    return Array.isArray(savedMsgs) && savedMsgs.length > 0;
  });

  const [inputMessage, setInputMessage] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolName, setActiveToolName] = useState(null);

  const fileInputRef = useRef(null);
  const chatBottomRef = useRef(null);

  const totalPts = ptsData.reduce((acc, curr) => acc + curr.value, 0);

  // Sync state changes to localStorage
  useEffect(() => {
    if (threadId) {
      try {
        localStorage.setItem(STORAGE_KEYS.THREAD_ID, threadId);
      } catch (e) {}
    }
  }, [threadId]);

  useEffect(() => {
    try {
      if (uploadedFileName) {
        localStorage.setItem(STORAGE_KEYS.UPLOADED_FILE_NAME, uploadedFileName);
      } else {
        localStorage.removeItem(STORAGE_KEYS.UPLOADED_FILE_NAME);
      }
    } catch (e) {}
  }, [uploadedFileName]);

  useEffect(() => {
    safeSetStorage(STORAGE_KEYS.PTS_DATA, ptsData);
  }, [ptsData]);

  useEffect(() => {
    safeSetStorage(STORAGE_KEYS.SEVERITY_COUNTS, severityCounts);
  }, [severityCounts]);

  useEffect(() => {
    safeSetStorage(STORAGE_KEYS.VULNERABILITIES, vulnerabilities);
  }, [vulnerabilities]);

  useEffect(() => {
    try {
      if (selectedCategory) {
        localStorage.setItem(STORAGE_KEYS.SELECTED_CATEGORY, selectedCategory);
      }
    } catch (e) {}
  }, [selectedCategory]);

  useEffect(() => {
    safeSetStorage(STORAGE_KEYS.CATEGORY_STATS, categoryStats);
  }, [categoryStats]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.IS_CHAT_OPEN, String(isChatOpen));
    } catch (e) {}
  }, [isChatOpen]);

  useEffect(() => {
    const cleanMsgs = messages.map(m => m.isStreaming ? { ...m, isStreaming: false } : m);
    safeSetStorage(STORAGE_KEYS.MESSAGES, cleanMsgs);
  }, [messages]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, activeToolName]);

  // Re-hydrate dashboard directly from backend findings API on refresh or initial load
  useEffect(() => {
    const fetchLatestFindings = async () => {
      try {
        const targetThread = threadId || 'latest';
        const res = await fetch(`${API_BASE}/api/v1/agentmesh/vapt/findings/${targetThread}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.is_vapt === false) {
            setSeverityCounts(DEFAULT_SEVERITY_COUNTS);
            setPtsData(DEFAULT_PTS_DATA);
            setVulnerabilities(DEFAULT_VULNERABILITIES);
            setCategoryStats({});
            setNonVaptDialogue(data.dialogue || null);
            return;
          }
          if (data && data.total_findings > 0) {
            if (data.thread_id && data.thread_id !== 'latest' && !threadId) {
              setThreadId(data.thread_id);
            }
            setSeverityCounts(data.severity_counts);
            setPtsData(data.pts_data);
            setVulnerabilities(data.vulnerabilities);
            if (data.category_stats) {
              setCategoryStats(data.category_stats);
            }
            if (data.categories && data.categories.length > 0 && !data.categories.includes(selectedCategory)) {
              setSelectedCategory(data.categories[0]);
            }
          }
        }
      } catch (err) {
        console.debug('Initial findings fetch skipped:', err);
      }
    };
    fetchLatestFindings();
  }, []);

  // Fetch paginated table records when category, page, or pageSize changes
  useEffect(() => {
    let isMounted = true;
    const fetchPage = async () => {
      if (totalPts === 0 && (!vulnerabilities[selectedCategory] || vulnerabilities[selectedCategory].length === 0)) {
        return;
      }
      setIsLoadingPage(true);
      try {
        const targetThread = threadId || 'latest';
        const params = new URLSearchParams({
          category: selectedCategory,
          page: String(currentPage),
          page_size: String(pageSize),
        });
        const res = await fetch(`${API_BASE}/api/v1/agentmesh/vapt/findings/${targetThread}/page?${params.toString()}`);
        if (res.ok) {
          const pageData = await res.json();
          if (isMounted) {
            setPageRecords(pageData.records || []);
            setTotalPages(pageData.total_pages || 1);
            setTotalCategoryRecords(pageData.total_records || 0);
          }
        }
      } catch (err) {
        console.debug('Pagination fetch error:', err);
      } finally {
        if (isMounted) {
          setIsLoadingPage(false);
        }
      }
    };

    fetchPage();
    return () => {
      isMounted = false;
    };
  }, [selectedCategory, currentPage, pageSize, threadId, totalPts]);

  // Reset Session
  const handleNewSession = () => {
    const newId = genThreadId();
    setThreadId(newId);
    setUploadedFileName(null);
    setMessages([]);
    setPtsData(DEFAULT_PTS_DATA);
    setSeverityCounts(DEFAULT_SEVERITY_COUNTS);
    setVulnerabilities(DEFAULT_VULNERABILITIES);
    setCategoryStats({});
    setPageRecords([]);
    setCurrentPage(1);
    setSelectedCategory('OS');
    setNonVaptDialogue(null);
    
    // Explicitly wipe storage
    Object.values(STORAGE_KEYS).forEach(k => {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    });
    try {
      localStorage.setItem(STORAGE_KEYS.THREAD_ID, newId);
    } catch (e) {}
  };

  // Client-side heuristics removed: dashboard populates exclusively from server Jev API findings

  const [isExporting, setIsExporting] = useState(false);

  // Export classified findings report (.xlsx)
  const handleExportReport = async () => {
    if (totalPts === 0) return;
    setIsExporting(true);
    try {
      const targetThread = threadId || 'latest';
      const url = `${API_BASE}/api/v1/agentmesh/vapt/findings/${targetThread}/export?format=xlsx`;
      
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Export failed with status ${res.status}`);
      }
      
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const baseName = uploadedFileName 
        ? uploadedFileName.replace(/\.[^/.]+$/, '') 
        : 'vapt_classified_findings';
      a.download = `${baseName}_classified.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Failed to export report:', err);
      alert(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Upload file & trigger AgentMesh pipeline
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Generate a fresh session thread for each new scan upload
    const currentThreadId = genThreadId();
    setThreadId(currentThreadId);
    try {
      localStorage.setItem(STORAGE_KEYS.THREAD_ID, currentThreadId);
    } catch (e) {}

    // Reset dashboard immediately to clean state (no premature client classification)
    setPtsData(DEFAULT_PTS_DATA);
    setSeverityCounts(DEFAULT_SEVERITY_COUNTS);
    setVulnerabilities(DEFAULT_VULNERABILITIES);
    setCategoryStats({});
    setPageRecords([]);
    setCurrentPage(1);
    setSelectedCategory('OS');
    setNonVaptDialogue(null);

    setIsUploading(true);
    setUploadStatusText('Uploading to AgentMesh storage...');
    setUploadedFileName(file.name);

    try {
      // 1. Upload file to AgentMesh artifact storage
      const formData = new FormData();
      formData.append('file', file);
      formData.append('thread_id', currentThreadId);
      formData.append('workflow_id', WORKFLOW_ID);

      const uploadRes = await fetch(`${API_BASE}/api/v1/agentmesh/execution/upload-artifact`, {
        method: 'POST',
        body: formData
      });

      if (!uploadRes.ok) {
        throw new Error(`Upload failed with status ${uploadRes.status}`);
      }

      const uploadData = await uploadRes.json();
      const artifactId = uploadData.artifact_id;

      // 3. Initiate the unified workflow on this thread
      setUploadStatusText('Starting workflow pipeline...');
      await fetch(`${API_BASE}/api/v1/agentmesh/workflow/${WORKFLOW_ID}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'run',
          thread_id: currentThreadId,
          input: 'Start verification process'
        })
      });

      // 4. Resume form_file_upload with the uploaded artifact
      setUploadStatusText('Validating report authenticity with LLM...');

      // Start live progress and real-time findings streaming
      let progressPoll = null;
      let isPollingActive = true;
      if (currentThreadId) {
        progressPoll = setInterval(async () => {
          if (!isPollingActive) return;
          try {
            const pRes = await fetch(`${API_BASE}/api/v1/agentmesh/vapt/progress/${currentThreadId}`);
            if (pRes.ok && isPollingActive) {
              const pData = await pRes.json();
              if (pData && pData.total > 0 && isPollingActive) {
                // Update live progress pill
                setUploadProgress({
                  completed: pData.completed,
                  total: pData.total,
                  percent: pData.percent,
                  status: pData.status
                });

                // STREAM CLASSIFIED DATA & METRICS TOGETHER IN REAL-TIME
                if (pData.dashboard_data && pData.dashboard_data.total_findings > 0) {
                  const d = pData.dashboard_data;
                  setSeverityCounts(d.severity_counts);
                  setPtsData(d.pts_data);
                  setVulnerabilities(d.vulnerabilities);
                  if (d.category_stats) setCategoryStats(d.category_stats);
                  if (d.categories && d.categories.length > 0) {
                    setSelectedCategory(prev => d.categories.includes(prev) ? prev : d.categories[0]);
                  }
                }

                if (pData.status === 'evaluating') {
                  setUploadStatusText(`Fetching vulnerabilities... (${pData.completed} / ${pData.total})`);
                }
              }
            }
          } catch (e) {}
        }, 500);
      }

      const resumeRes = await fetch(`${API_BASE}/api/v1/agentmesh/workflow/${WORKFLOW_ID}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'resume',
          thread_id: currentThreadId,
          action: 'submit',
          payload: {
            uploaded_file: {
              artifact_id: artifactId,
              filename: file.name
            }
          }
        })
      });

      const resumeData = await resumeRes.json();
      
      // Stop in-flight polling
      isPollingActive = false;
      if (progressPoll) {
        clearInterval(progressPoll);
        progressPoll = null;
      }

      setUploadStatusText('Fetching vulnerabilities...');
      let findingsData = null;

      // 1. First priority: Use findings already present in resumeData.context (instant, 0 network delay)
      if (resumeData.context?.excel_json_data && Array.isArray(resumeData.context.excel_json_data) && resumeData.context.excel_json_data.length > 0) {
        try {
          const directRes = await fetch(`${API_BASE}/api/v1/agentmesh/vapt/findings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: resumeData.context.excel_json_data,
              thread_id: currentThreadId,
              is_vapt: resumeData.context?.is_vapt
            })
          });
          if (directRes.ok) {
            findingsData = await directRes.json();
          }
        } catch (e) {
          console.warn('[VAPT] Direct findings processing exception:', e);
        }
      }

      // 2. Fallback: Fetch from server findings with a strict 3s timeout so it CANNOT hang the UI
      if (!findingsData || findingsData.total_findings === 0) {
        try {
          const abortCtrl = new AbortController();
          const timer = setTimeout(() => abortCtrl.abort(), 3000);
          const findingsRes = await fetch(`${API_BASE}/api/v1/agentmesh/vapt/findings/${currentThreadId}`, {
            signal: abortCtrl.signal
          });
          clearTimeout(timer);
          if (findingsRes.ok) {
            const sData = await findingsRes.json();
            if (sData && sData.total_findings > 0) {
              findingsData = sData;
            }
          }
        } catch (fErr) {
          console.warn('[VAPT] Could not fetch server findings:', fErr);
        }
      }

      const isNonVapt = (findingsData && findingsData.is_vapt === false) || (resumeData.context?.is_vapt === false);

      if (isNonVapt) {
        // NON-VAPT REPORT: Reset all metrics to zero, do NOT count vulnerability points
        setSeverityCounts(DEFAULT_SEVERITY_COUNTS);
        setPtsData(DEFAULT_PTS_DATA);
        setVulnerabilities(DEFAULT_VULNERABILITIES);
        setSelectedCategory('OS');
        setUploadedFileName(null);

        const nonVaptReason = findingsData?.reason || resumeData.context?.reason || 'The provided JSON contains inventory/non-security data with no vulnerability identifiers or severity scores.';
        const dialogueObj = findingsData?.dialogue || {
          type: 'non_vapt_report',
          title: 'Non-VAPT Report Detected',
          reason: nonVaptReason,
          scanner_type: findingsData?.scanner_type || resumeData.context?.scanner_type || 'Unknown'
        };

        setNonVaptDialogue(dialogueObj);

        // ONLY the concise warning paragraph in chat (no intermediate Excel JSON or raw parser strings)
        const warningMsg = `⚠️ The uploaded file is not a valid VAPT report.

• **Reason:** ${nonVaptReason}

Please check your file and upload an authentic vulnerability scan report.`;
        setMessages([
          {
            id: `non-vapt-${Date.now()}`,
            role: 'agent',
            content: warningMsg,
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
        setIsChatOpen(true);
      } else {
        // AUTHENTIC VAPT REPORT: Populate findings from server API
        setNonVaptDialogue(null);
        if (findingsData && findingsData.total_findings > 0) {
          setSeverityCounts(findingsData.severity_counts);
          setPtsData(findingsData.pts_data);
          setVulnerabilities(findingsData.vulnerabilities);
          if (findingsData.category_stats) {
            setCategoryStats(findingsData.category_stats);
          }
          if (findingsData.categories && findingsData.categories.length > 0) {
            setSelectedCategory(findingsData.categories[0]);
          }
        }

        // STOP SPINNER & PROGRESS BAR IMMEDIATELY
        setIsUploading(false);
        setUploadStatusText('');
        setUploadProgress(null);

        // Clean user-facing messages (filter out lengthy intermediate Excel dumps & raw validator JSON)
        const cleanMsgs = [];
        if (resumeData.messages && Array.isArray(resumeData.messages)) {
          resumeData.messages.forEach((m, i) => {
            const typeStr = String(m.type || m.role || '').toLowerCase();
            if (typeStr.includes('ai') || typeStr.includes('assistant')) {
              const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
              // Filter out noisy intermediate debug messages
              if (text.includes('Excel converted to JSON successfully') || text.includes('📊 **Excel converted')) {
                return;
              }
              if (text.includes('"is_vapt"')) {
                return;
              }
              if (text.includes('[Internal Execution Content]') || text.includes('[Internal Execution Completed]')) {
                return;
              }
              cleanMsgs.push({
                id: `init-${Date.now()}-${i}`,
                role: 'agent',
                content: text,
                timestamp: new Date().toLocaleTimeString()
              });
            }
          });
        }

        if (cleanMsgs.length === 0) {
          cleanMsgs.push({
            id: `init-${Date.now()}`,
            role: 'agent',
            content: `✅ **VAPT Report Validated Successfully**

• **File:** \`${file.name}\`
• **Findings Loaded:** ${findingsData?.total_findings || 'All'} records classified by TypeSafe Jev Engine into categories.

Which vulnerability category (OS, Network, Database, Application) would you like to focus on for remediation?`,
            timestamp: new Date().toLocaleTimeString()
          });
        }

        setMessages(cleanMsgs);
        setIsChatOpen(true);

        // Auto-resume Deep Agent in background if paused at remediation gate
        if (resumeData && resumeData.is_paused && (resumeData.next_node === 'deep_agent_wfl18' || String(resumeData.next_node || '').includes('deep_agent'))) {
          console.log('[VAPT] Triggering background Deep Agent initialization on thread:', currentThreadId);
          fetch(`${API_BASE}/api/v1/agentmesh/workflow/${WORKFLOW_ID}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: 'resume',
              thread_id: currentThreadId,
              action: 'approve',
              payload: {
                decision: 'Proceed for Remediation'
              }
            })
          })
          .then(res => res.json())
          .then(agentData => {
            console.log('[VAPT] Background Deep Agent finished:', agentData);
            if (agentData && agentData.messages && Array.isArray(agentData.messages)) {
              const agentMsgs = [];
              agentData.messages.forEach((m, idx) => {
                const typeStr = String(m.type || m.role || '').toLowerCase();
                if (typeStr.includes('ai') || typeStr.includes('assistant')) {
                  const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                  if (text && text.trim() && !text.includes('[Internal Execution')) {
                    agentMsgs.push({
                      id: `deep-agent-${Date.now()}-${idx}`,
                      role: 'agent',
                      content: text,
                      timestamp: new Date().toLocaleTimeString()
                    });
                  }
                }
              });
              if (agentMsgs.length > 0) {
                setMessages(prev => [...prev, ...agentMsgs]);
              }
            }
          })
          .catch(agentErr => {
            console.warn('[VAPT] Deep Agent background resume error:', agentErr);
          });
        }
      }

    } catch (err) {
      console.error('Upload & verification error:', err);
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'agent',
          content: `⚠️ **Processing Failed**: ${err.message || 'Could not process and validate scan report.'}`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
      setIsChatOpen(true);
    } finally {
      isPollingActive = false;
      if (progressPoll) clearInterval(progressPoll);
      setIsUploading(false);
      setUploadStatusText('');
      setUploadProgress(null);
      if (event.target) event.target.value = '';
    }
  };

  // Stream Deep Agent responses via SSE
  const handleSendMessage = async (textToSend) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isStreaming) return;

    setInputMessage('');
    const userMsgId = `user-${Date.now()}`;
    const agentMsgId = `agent-${Date.now()}`;

    // Append user message
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: text, timestamp: new Date().toLocaleTimeString() },
      { id: agentMsgId, role: 'agent', content: '', isStreaming: true, timestamp: new Date().toLocaleTimeString() }
    ]);

    setIsStreaming(true);
    setActiveToolName(null);

    try {
      const response = await fetch(`${API_BASE}/api/v1/agentmesh/workflow/${WORKFLOW_ID}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'stream',
          thread_id: threadId,
          input: text
        })
      });

      if (!response.ok) {
        throw new Error(`Execution error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const jsonStr = trimmed.replace(/^data:\s*/, '');
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            // 1. Live token stream from LLM
            if (event.type === 'token' && event.content) {
              accumulatedContent += event.content;
              setMessages(prev => prev.map(m => 
                m.id === agentMsgId ? { ...m, content: accumulatedContent, isStreaming: true } : m
              ));
            }
            // 2. Tool invocation notification
            else if (event.type === 'tool_call') {
              const toolLabel = event.tool === 'analyze_vapt_csv'
                ? 'Analyzing VAPT Scan Findings...'
                : event.tool === 'query_vapt_report'
                ? 'Querying Report Details...'
                : event.tool === 'execute_ssh_mitigation'
                ? 'Executing SSH Mitigation Commands...'
                : `Executing ${event.tool}...`;
              setActiveToolName(toolLabel);
            }
            // 3. Tool completed
            else if (event.type === 'tool_result') {
              setActiveToolName(null);
            }
            // 4. Final state snapshot
            else if (event.type === 'final') {
              const finalOutput = event.content || event.output || accumulatedContent;
              setMessages(prev => prev.map(m => 
                m.id === agentMsgId ? { ...m, content: finalOutput, isStreaming: false } : m
              ));
            }
            // 5. Error event
            else if (event.type === 'error') {
              accumulatedContent += `\n\n⚠️ *System Error: ${event.message || 'Operation failed'}*`;
              setMessages(prev => prev.map(m => 
                m.id === agentMsgId ? { ...m, content: accumulatedContent, isStreaming: false } : m
              ));
            }
          } catch (e) {
            // Non-JSON SSE line, continue
          }
        }
      }

      // Mark streaming done
      setMessages(prev => prev.map(m => 
        m.id === agentMsgId ? { ...m, isStreaming: false } : m
      ));

    } catch (err) {
      console.error('Streaming error:', err);
      setMessages(prev => prev.map(m => 
        m.id === agentMsgId ? { 
          ...m, 
          content: `⚠️ **Error communicating with Deep Agent**: ${err.message}`, 
          isStreaming: false 
        } : m
      ));
    } finally {
      setIsStreaming(false);
      setActiveToolName(null);
    }
  };

  const selectedCategoryStats = categoryStats[selectedCategory] || {
    total: vulnerabilities[selectedCategory]?.length || 0,
    Critical: vulnerabilities[selectedCategory]?.filter(v => v.severity === 'Critical').length || 0,
    High: vulnerabilities[selectedCategory]?.filter(v => v.severity === 'High').length || 0,
    Medium: vulnerabilities[selectedCategory]?.filter(v => v.severity === 'Medium').length || 0,
    Low: vulnerabilities[selectedCategory]?.filter(v => v.severity === 'Low').length || 0,
    Info: vulnerabilities[selectedCategory]?.filter(v => v.severity === 'Info').length || 0,
  };

  const totalInCurrentCategory = categoryStats[selectedCategory]?.total !== undefined 
    ? categoryStats[selectedCategory].total 
    : (totalCategoryRecords || vulnerabilities[selectedCategory]?.length || 0);

  const effectiveTotalPages = totalPages > 1 
    ? totalPages 
    : Math.max(1, Math.ceil(totalInCurrentCategory / pageSize));

  const displayedRows = pageRecords.length > 0 
    ? pageRecords 
    : (vulnerabilities[selectedCategory]?.slice((currentPage - 1) * pageSize, currentPage * pageSize) 
       || vulnerabilities[selectedCategory]?.slice(0, pageSize) 
       || []);

  return (
    <div className="vapt-app-container">
      {/* Top Header / Action Bar */}
      <div className="vapt-header-bar">
        <div className="vapt-title-group">
          <Shield size={20} color="#df4c7b" />
          <span className="vapt-title">VAPT Automated Remediation & Deep Analyst</span>
          <span className="vapt-badge">AgentMesh v2.0</span>
          {uploadedFileName && (
            <span style={{ fontSize: '0.82rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <FileSpreadsheet size={15} color="#059669" />
              <strong>{uploadedFileName}</strong>
            </span>
          )}
        </div>

        <div className="vapt-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Right-aligned Live Progress Pill */}
          {isUploading && uploadProgress && uploadProgress.total > 0 && (
            <div className="vapt-progress-pill animate-fade-in">
              <div className="vapt-progress-pill-header">
                <span className="vapt-progress-pulse" />
                <span className="vapt-progress-pill-title">Fetching vulnerabilities</span>
                <span className="vapt-progress-pill-stats">
                  {uploadProgress.completed.toLocaleString()} of {uploadProgress.total.toLocaleString()} ({uploadProgress.percent}%)
                </span>
              </div>
              <div className="vapt-progress-pill-track">
                <div
                  className="vapt-progress-pill-bar"
                  style={{ width: `${Math.min(100, Math.max(4, uploadProgress.percent))}%` }}
                />
              </div>
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            accept=".xlsx,.xls,.csv"
          />
          <button
            className="vapt-btn vapt-btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isStreaming}
          >
            {isUploading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>{uploadStatusText || 'Uploading...'}</span>
              </>
            ) : (
              <>
                <Upload size={16} />
                <span>Upload Scan Report</span>
              </>
            )}
          </button>

          <button
            className="vapt-btn vapt-btn-secondary"
            onClick={handleExportReport}
            disabled={isExporting || isUploading || isStreaming || totalPts === 0}
            title="Download classified scan report (.xlsx)"
          >
            {isExporting ? (
              <>
                <Loader2 size={15} className="vapt-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download size={15} />
                <span>Download Report</span>
              </>
            )}
          </button>

          <button
            className="vapt-btn vapt-btn-secondary" 
            onClick={handleNewSession}
            disabled={isUploading || isStreaming}
            title="Start New Session"
          >
            <RefreshCw size={15} />
            <span>New Session</span>
          </button>
        </div>
      </div>



      {/* Main Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', maxWidth: '1400px', margin: '0 auto' }}>
        {/* Hero Section */}
        <div className="vapt-hero-card">
          <div>
            <h2>Total Vulnerability Points</h2>
            <div className="vapt-hero-points">{totalPts}</div>
            <div className="vapt-hero-sub">Assessed across all infrastructure hosts & services</div>
          </div>

          <div className="vapt-hero-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={ptsData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {ptsData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <RechartsTooltip 
                  formatter={(value) => `${totalPts > 0 ? ((value / totalPts) * 100).toFixed(1) : 0}% (${value})`}
                  itemStyle={{ color: '#401526', fontWeight: 600 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Severity Counters Grid */}
        <div className="vapt-severity-grid">
          <div className="vapt-stat-card" style={{ borderTop: '4px solid #401526' }}>
            <div className="vapt-stat-header">
              <span className="vapt-stat-label" style={{ color: '#401526' }}>Critical (4)</span>
              <Shield size={18} color="#401526" />
            </div>
            <div className="vapt-stat-value">{severityCounts.s0}</div>
          </div>

          <div className="vapt-stat-card" style={{ borderTop: '4px solid #672845' }}>
            <div className="vapt-stat-header">
              <span className="vapt-stat-label" style={{ color: '#672845' }}>High (3)</span>
              <Shield size={18} color="#672845" />
            </div>
            <div className="vapt-stat-value">{severityCounts.s1}</div>
          </div>

          <div className="vapt-stat-card" style={{ borderTop: '4px solid #7a3553' }}>
            <div className="vapt-stat-header">
              <span className="vapt-stat-label" style={{ color: '#7a3553' }}>Medium (2)</span>
              <Shield size={18} color="#7a3553" />
            </div>
            <div className="vapt-stat-value">{severityCounts.s2}</div>
          </div>

          <div className="vapt-stat-card" style={{ borderTop: '4px solid #9d6583' }}>
            <div className="vapt-stat-header">
              <span className="vapt-stat-label" style={{ color: '#9d6583' }}>Low (1)</span>
              <Shield size={18} color="#9d6583" />
            </div>
            <div className="vapt-stat-value">{severityCounts.s3}</div>
          </div>

          <div className="vapt-stat-card" style={{ borderTop: '4px solid #df4c7b' }}>
            <div className="vapt-stat-header">
              <span className="vapt-stat-label" style={{ color: '#df4c7b' }}>Info (0)</span>
              <Shield size={18} color="#df4c7b" />
            </div>
            <div className="vapt-stat-value">{severityCounts.s4}</div>
          </div>
        </div>

        {/* Category Tabs & Table */}
        <div className="vapt-panel">
          <div className="vapt-tabs">
            {Object.keys(vulnerabilities).map(cat => {
              const count = categoryStats[cat]?.total !== undefined 
                ? categoryStats[cat].total 
                : (vulnerabilities[cat]?.length || 0);
              return (
                <button
                  key={cat}
                  className={`vapt-tab-btn ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setCurrentPage(1);
                  }}
                >
                  {cat} ({count.toLocaleString()})
                </button>
              );
            })}
          </div>

          {/* Selected Category KPI Strip */}
          <div className="vapt-kpi-strip">
            <div>
              <div className="vapt-kpi-label">Total In Category</div>
              <div className="vapt-kpi-val">{(selectedCategoryStats.total || 0).toLocaleString()}</div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="vapt-pill vapt-pill-critical">CRITICAL: {(selectedCategoryStats.Critical || 0).toLocaleString()}</span>
              <span className="vapt-pill vapt-pill-high">HIGH: {(selectedCategoryStats.High || 0).toLocaleString()}</span>
              <span className="vapt-pill vapt-pill-medium">MEDIUM: {(selectedCategoryStats.Medium || 0).toLocaleString()}</span>
              <span className="vapt-pill vapt-pill-low">LOW: {(selectedCategoryStats.Low || 0).toLocaleString()}</span>
              <span className="vapt-pill vapt-pill-info">INFO: {(selectedCategoryStats.Info || 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Table */}
          <div className="vapt-table-wrap">
            <table className="vapt-table">
              <thead>
                <tr>
                  <th>Vulnerability</th>
                  <th>Severity</th>
                  <th>Resource / Asset</th>
                  <th>AI Confidence</th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((v) => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 500, color: 'var(--text-secondary, #475569)' }}>{v.name}</td>
                    <td>
                      <span className={`vapt-pill vapt-pill-${(v.severity || 'info').toLowerCase()}`}>
                        {v.severity}
                      </span>
                    </td>
                    <td>
                      <div style={{ color: 'var(--text-primary, #0f172a)' }}>{v.host}</div>
                      <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>
                        {v.status || 'Pending'}
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#6366f1' }}>
                        {typeof v.confidence === 'number' ? `${Math.round(v.confidence * 100)}%` : '--'}
                      </span>
                    </td>
                  </tr>
                ))}
                {displayedRows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                      {isLoadingPage ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                          <Loader2 className="vapt-spin" size={18} />
                          <span>Loading findings...</span>
                        </div>
                      ) : uploadedFileName ? (
                        'No vulnerabilities found for this category.'
                      ) : (
                        'Upload a VAPT scan report (.xlsx or .csv) above.'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Modern Pagination Controls */}
          {totalInCurrentCategory > 0 && (
            <div className="vapt-pagination-bar">
              <div className="vapt-pagination-info">
                Showing <strong>{((currentPage - 1) * pageSize + 1).toLocaleString()}</strong> -{' '}
                <strong>{Math.min(currentPage * pageSize, totalInCurrentCategory).toLocaleString()}</strong> of{' '}
                <strong>{totalInCurrentCategory.toLocaleString()}</strong> findings
                {isLoadingPage && (
                  <Loader2 size={14} className="vapt-spin" style={{ marginLeft: '0.5rem', verticalAlign: 'middle', color: '#7a3553' }} />
                )}
              </div>

              <div className="vapt-pagination-actions">
                {/* Rows per page selector */}
                <div className="vapt-page-size-wrap">
                  <span className="vapt-page-size-label">Rows per page:</span>
                  <select
                    className="vapt-page-size-select"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                </div>

                {/* Page Navigation Button Group */}
                <div className="vapt-page-btn-group">
                  <button
                    className="vapt-page-btn"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage <= 1 || isLoadingPage}
                    title="First Page"
                  >
                    <ChevronsLeft size={16} />
                  </button>
                  <button
                    className="vapt-page-btn"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage <= 1 || isLoadingPage}
                    title="Previous Page"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  <span className="vapt-page-indicator">
                    Page <strong>{currentPage.toLocaleString()}</strong> of <strong>{effectiveTotalPages.toLocaleString()}</strong>
                  </span>

                  <button
                    className="vapt-page-btn"
                    onClick={() => setCurrentPage(p => Math.min(effectiveTotalPages, p + 1))}
                    disabled={currentPage >= effectiveTotalPages || isLoadingPage}
                    title="Next Page"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    className="vapt-page-btn"
                    onClick={() => setCurrentPage(effectiveTotalPages)}
                    disabled={currentPage >= effectiveTotalPages || isLoadingPage}
                    title="Last Page"
                  >
                    <ChevronsRight size={16} />
                  </button>
                </div>

                {/* Direct Page Jump */}
                {effectiveTotalPages > 1 && (
                  <form
                    className="vapt-page-jump-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const p = parseInt(pageJumpInput, 10);
                      if (!isNaN(p) && p >= 1 && p <= effectiveTotalPages) {
                        setCurrentPage(p);
                        setPageJumpInput('');
                      }
                    }}
                  >
                    <input
                      type="number"
                      min={1}
                      max={effectiveTotalPages}
                      placeholder="Go to..."
                      className="vapt-page-jump-input"
                      value={pageJumpInput}
                      onChange={(e) => setPageJumpInput(e.target.value)}
                    />
                    <button type="submit" className="vapt-page-jump-btn" disabled={!pageJumpInput || isLoadingPage}>
                      Go
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

            {/* Non-VAPT Report Dialogue Modal */}
      {nonVaptDialogue && (
        <div className="vapt-dialog-backdrop" onClick={() => setNonVaptDialogue(null)}>
          <div className="vapt-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="vapt-dialog-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div className="vapt-dialog-icon-wrap">
                  <AlertTriangle size={22} color="#dc2626" />
                </div>
                <div>
                  <h3 className="vapt-dialog-title">Non-VAPT Report Detected</h3>
                  <div className="vapt-dialog-sub">Security verification gate rejected this document</div>
                </div>
              </div>
              <button 
                onClick={() => setNonVaptDialogue(null)} 
                className="vapt-dialog-close-btn"
                title="Dismiss"
              >
                <X size={18} />
              </button>
            </div>

            <div className="vapt-dialog-body">
              <div className="vapt-dialog-alert-box">
                <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: '0.4rem' }}>
                  ⚠️ The uploaded file is not a valid VAPT report.
                </div>
                <div style={{ color: '#4b5563', fontSize: '0.9rem', lineHeight: '1.45' }}>
                  <strong>• Reason:</strong> {nonVaptDialogue.reason || 'The provided JSON contains inventory/non-security data with no security identifiers, severity scores, or asset vulnerability information.'}
                </div>
              </div>
              <p style={{ marginTop: '0.85rem', color: '#64748b', fontSize: '0.85rem', lineHeight: '1.4' }}>
                Please check your file and upload an authentic vulnerability scan report (e.g., from Tenable Nessus, Qualys, Burp Suite, or Aikido Security).
              </p>
            </div>

            <div className="vapt-dialog-footer">
              <button 
                className="vapt-btn vapt-btn-primary" 
                onClick={() => {
                  setNonVaptDialogue(null);
                  fileInputRef.current?.click();
                }}
              >
                <Upload size={16} />
                <span>Upload Authentic Scan</span>
              </button>
              <button 
                className="vapt-btn vapt-btn-secondary" 
                onClick={() => setNonVaptDialogue(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Chat Trigger Button */}
      <div 
        className="chatbot-trigger" 
        onClick={() => setIsChatOpen(!isChatOpen)}
        title="Open VAPT Assistant"
      >
        <MessageSquare size={28} />
      </div>

      {/* Floating Chat Popup Window */}
      {isChatOpen && (
        <div className="chat-popup">
          <div className="chat-header">
            <div className="chat-header-title">
              <Shield size={18} />
              <span>VAPT Deep Security Analyst</span>
              <span className="chat-header-badge">Live Connected</span>
            </div>

            <div className="chat-header-actions">
              <button
                className="chat-header-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Upload Scan File"
                disabled={isUploading || isStreaming}
              >
                <Upload size={14} />
              </button>
              <button
                className="chat-header-btn"
                onClick={handleNewSession}
                title="New Session"
                disabled={isUploading || isStreaming}
              >
                <Plus size={16} />
              </button>
              <button
                className="chat-header-btn"
                onClick={() => setIsChatOpen(false)}
                title="Close Assistant"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="chat-messages">
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1.5rem', color: '#64748b' }}>
                <Shield size={36} color="#df4c7b" style={{ margin: '0 auto 1rem', opacity: 0.8 }} />
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', marginBottom: '0.5rem' }}>
                  VAPT Deep Analyst Ready
                </div>
                <p style={{ fontSize: '0.875rem', margin: 0, color: '#64748b', lineHeight: 1.5 }}>
                  Upload a VAPT scan report (.xlsx or .csv) to begin automated vulnerability analysis and remediation.
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`chat-message ${m.role === 'user' ? 'user' : 'bot'}`}>
                  {m.role === 'user' ? (
                    <div>{m.content}</div>
                  ) : (
                    <div className="md-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              ))
            )}

            {isStreaming && (
              <div className="chat-message bot" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ThinkingDots />
                <span style={{ fontStyle: 'italic', color: '#64748b' }}>
                  {activeToolName ? `Running tool: ${activeToolName}...` : 'Analyzing...'}
                </span>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Subtle Suggestion Chips */}
          <div className="chat-suggestions">
            <button 
              className="chat-chip" 
              onClick={() => handleSendMessage('I want to remediate OS critical ones')}
              disabled={isStreaming}
            >
              Remediate OS Critical ones
            </button>
            <button 
              className="chat-chip" 
              onClick={() => handleSendMessage('High Severity Findings')}
              disabled={isStreaming}
            >
              High Severity Findings
            </button>
            <button 
              className="chat-chip" 
              onClick={() => handleSendMessage('Summarize Vulnerabilities')}
              disabled={isStreaming}
            >
              Summarize Vulnerabilities
            </button>
          </div>

          {/* Chat Input Area */}
          <div className="chat-input-area">
            <input
              type="text"
              className="chat-input"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask anything or request remediation (e.g. 'I want to remediate OS critical ones')..."
              disabled={isStreaming}
            />
            <button
              className="chat-send-btn"
              onClick={() => handleSendMessage()}
              disabled={!inputMessage.trim() || isStreaming}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
