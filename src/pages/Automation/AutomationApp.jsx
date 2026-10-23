import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  MessageSquare, 
  Send, 
  CheckCircle, 
  XCircle, 
  Play, 
  Loader2, 
  LogOut, 
  Database, 
  ChevronRight, 
  X, 
  Info,
  Layers,
  Settings,
  Plus,
  Edit
} from 'lucide-react';
import './AutomationApp.css';

const API_BASE = 'http://localhost:8000/api/v1/agentmesh';

export default function AutomationApp() {
  const [user, setUser] = useState({ username: 'admin', role: 'admin' });
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');

  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  
  // Chat Widget State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'bot', text: 'Hello! I am the OCI Automation Assistant. What networking or compute infrastructure tasks would you like to perform today?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [useMock, setUseMock] = useState(false);
  const [chatThreadId, setChatThreadId] = useState(null);

  // Rework HITL states
  const [showReworkTaskId, setShowReworkTaskId] = useState(null);
  const [reworkFeedback, setReworkFeedback] = useState('');
  const [includeOriginal, setIncludeOriginal] = useState(true);
  const [injectFeedback, setInjectFeedback] = useState(true);
  const [isReworkSubmitting, setIsReworkSubmitting] = useState(false);

  // Poll Tasks
  useEffect(() => {
    if (!user) return;
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [user]);

  const fetchTasks = async () => {
    // Tasks fetching disabled since Maker/Checker is removed
    setTasks([]);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (usernameInput === 'maker' && passwordInput === 'password') {
      const u = { username: 'maker', role: 'maker' };
      setUser(u);
      localStorage.setItem('oci_user', JSON.stringify(u));
      setLoginError('');
    } else if (usernameInput === 'checker' && passwordInput === 'password') {
      const u = { username: 'checker', role: 'checker' };
      setUser(u);
      localStorage.setItem('oci_user', JSON.stringify(u));
      setLoginError('');
    } else {
      setLoginError('Invalid username or password (use maker/password or checker/password)');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('oci_user');
    setSelectedTask(null);
    setIsChatOpen(false);
    setChatThreadId(null);
    setChatMessages([
      { role: 'bot', text: 'Hello! I am the OCI Automation Assistant. What networking or compute infrastructure tasks would you like to perform today?' }
    ]);
  };

  const handleNewChat = () => {
    setChatThreadId(null);
    setChatMessages([
      { role: 'bot', text: 'Hello! I am the OCI Automation Assistant. What networking or compute infrastructure tasks would you like to perform today?' }
    ]);
    setChatInput('');
  };

  // Send message to NLP Proxy
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput;
    setChatMessages(prev => [...prev, { role: 'user', text: userText }]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/workflow/e3d237ec-5ecd-4c69-a553-f49db8848ef3/execute`, {
        input: userText,
        thread_id: chatThreadId || undefined,
        mode: 'run',
        context: {
          created_by: user.username
        }
      });

      const data = response.data;
      if (data.session_id) {
        setChatThreadId(data.session_id);
      }
      let botResponse = '';

      if (data.status === 'completed' || data.status === 'success') {
        if (data.output) {
          botResponse = data.output;
        } else {
          botResponse = 'Request processed successfully.';
        }
      } else {
        botResponse = `Error processing workflow: ${data.message || data.status || 'Unknown error'}`;
      }

      setChatMessages(prev => [...prev, { role: 'bot', text: botResponse }]);
      fetchTasks();
    } catch (error) {
      console.error('NLP Proxy error:', error);
      setChatMessages(prev => [...prev, { role: 'bot', text: 'Error connecting to the backend NLP Proxy service.' }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Approve human review step
  const handleApprove = async (workflowId, threadId) => {
    try {
      const response = await axios.post(`${API_BASE}/workflow/${workflowId}/thread/${threadId}/approve`, {
        payload: { approved_by: user.username },
        mock: useMock
      });
      alert('Task Approved successfully!');
      fetchTasks();
    } catch (error) {
      console.error('Approval failed:', error);
      alert('Failed to approve human step.');
    }
  };

  // Reject human review step
  const handleReject = async (workflowId, threadId) => {
    try {
      const response = await axios.post(`${API_BASE}/workflow/${workflowId}/thread/${threadId}/reject`, {
        payload: { approved_by: user.username },
        mock: useMock
      });
      alert('Task Rejected successfully.');
      fetchTasks();
    } catch (error) {
      console.error('Rejection failed:', error);
      alert('Failed to reject human step.');
    }
  };

  // Rework human review step
  const handleRework = async (workflowId, threadId, taskId) => {
    setIsReworkSubmitting(true);
    try {
      await axios.post(`${API_BASE}/workflow/${workflowId}/thread/${threadId}/rework`, {
        payload: {
          feedback: reworkFeedback,
          include_original_output: includeOriginal,
          inject_feedback: injectFeedback,
          approved_by: user.username
        },
        mock: useMock
      });
      alert('Rework request submitted successfully.');
      setShowReworkTaskId(null);
      setReworkFeedback('');
      fetchTasks();
    } catch (error) {
      console.error('Rework failed:', error);
      alert('Failed to submit rework request.');
    } finally {
      setIsReworkSubmitting(false);
    }
  };

  return (
    <div className="app-container">

      <main className="dashboard-layout">
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Database size={22} style={{ color: 'var(--primary-color)' }} />
              {user.role === 'maker' ? 'Your Triggered Infra Tasks' : 'Infra Tasks & Approvals Portal'}
            </h2>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th className="col-task-name">Task Name</th>
                  <th className="col-operation">Operation</th>
                  <th className="col-created-by">Created By</th>
                  <th className="col-created-at">Created At</th>
                  <th className="col-status">Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                      No infra tasks logged in database.
                    </td>
                  </tr>
                ) : (
                  tasks
                    .map(task => (
                      <React.Fragment key={task.id}>
                        <tr>
                          <td style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{task.task_name}</td>
                          <td style={{ textTransform: 'capitalize' }}>{task.operation}</td>
                          <td style={{ textTransform: 'capitalize', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            {task.created_by || 'system'}
                          </td>
                          <td style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            {new Date(task.created_at).toLocaleString()}
                          </td>
                          <td>
                            <span className={`status-indicator ${task.status}`}>
                              {task.status}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              {user.role === 'checker' && task.status === 'pending' && (
                                <>
                                  <button 
                                    className="btn btn-primary" 
                                    style={{ padding: '0.35rem 0.75rem', background: 'var(--success-color)', fontSize: '0.85rem' }}
                                    onClick={() => handleApprove(task.workflow_id, task.thread_id)}
                                  >
                                    <CheckCircle size={14} /> Approve
                                  </button>
                                  <button 
                                    className="btn btn-secondary" 
                                    style={{ padding: '0.35rem 0.75rem', borderColor: '#8E77BB', color: '#8E77BB', fontSize: '0.85rem' }}
                                    onClick={() => {
                                      setReworkFeedback('');
                                      setShowReworkTaskId(showReworkTaskId === task.id ? null : task.id);
                                    }}
                                  >
                                    <Edit size={14} /> Rework
                                  </button>
                                  <button 
                                    className="btn btn-secondary" 
                                    style={{ padding: '0.35rem 0.75rem', borderColor: 'var(--error-color)', color: 'var(--error-color)', fontSize: '0.85rem' }}
                                    onClick={() => handleReject(task.workflow_id, task.thread_id)}
                                  >
                                    <XCircle size={14} /> Reject
                                  </button>
                                </>
                              )}
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                                onClick={() => setSelectedTask(task)}
                              >
                                <Info size={14} /> Details
                              </button>
                            </div>
                          </td>
                        </tr>
                        {showReworkTaskId === task.id && (
                          <tr>
                            <td colSpan="6" style={{ padding: '1.5rem', background: 'rgba(142, 119, 187, 0.05)', borderBottom: '2px solid rgba(142, 119, 187, 0.15)' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '600px', margin: '0 auto' }}>
                                <div style={{ fontSize: '11px', fontWeight: 900, color: '#8E77BB', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <Edit size={14} /> REWORK PARAMETERS
                                </div>
                                <div>
                                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#6B7280', marginBottom: '8px', textTransform: 'uppercase' }}>
                                    Your Feedback <span style={{ color: '#EF4444', marginLeft: '4px' }}>*</span>
                                  </label>
                                  <textarea
                                    value={reworkFeedback}
                                    onChange={e => setReworkFeedback(e.target.value)}
                                    placeholder="What would you like the agent to adjust? (e.g. 'Focus more on recent developments')"
                                    style={{
                                      width: '100%',
                                      minHeight: '100px',
                                      padding: '12px',
                                      borderRadius: '8px',
                                      border: '1px solid #E5E7EB',
                                      background: '#FFFFFF',
                                      fontSize: '13px',
                                      fontFamily: 'inherit',
                                      resize: 'vertical',
                                      outline: 'none',
                                      boxSizing: 'border-box',
                                      lineHeight: 1.5
                                    }}
                                  />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={includeOriginal}
                                      onChange={e => setIncludeOriginal(e.target.checked)}
                                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#8E77BB' }}
                                    />
                                    <span style={{ fontSize: '12px', color: '#6B7280' }}>Include original output for reference</span>
                                  </label>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={injectFeedback}
                                      onChange={e => setInjectFeedback(e.target.checked)}
                                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#8E77BB' }}
                                    />
                                    <span style={{ fontSize: '12px', color: '#6B7280' }}>Inject feedback into next prompt</span>
                                  </label>
                                </div>
                                <div style={{ display: 'flex', gap: '12px', paddingTop: '12px', borderTop: '1px solid #E5E7EB' }}>
                                  <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowReworkTaskId(null)}
                                    disabled={isReworkSubmitting}
                                    style={{ flex: 1, padding: '10px 16px', fontWeight: 700 }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="btn btn-primary"
                                    onClick={() => handleRework(task.workflow_id, task.thread_id, task.id)}
                                    disabled={isReworkSubmitting || !reworkFeedback.trim()}
                                    style={{ flex: 1, padding: '10px 16px', background: isReworkSubmitting || !reworkFeedback.trim() ? '#E5E7EB' : '#8E77BB', color: isReworkSubmitting || !reworkFeedback.trim() ? '#9CA3AF' : 'white', border: 'none', fontWeight: 700 }}
                                  >
                                    {isReworkSubmitting ? 'Submitting...' : 'Submit Rework'}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Floating Chatbot Widget for Maker and Checker */}
      {true && (
        <>
          <div className="chatbot-trigger" onClick={() => setIsChatOpen(!isChatOpen)}>
            <MessageSquare size={28} />
          </div>

          {isChatOpen && (
            <div className="chat-popup glass-panel">
              <div className="chat-header">
                <span>OCI NLP Agent Mesh</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <button 
                    onClick={handleNewChat} 
                    title="New Chat"
                    style={{
                      background: 'rgba(255, 255, 255, 0.15)',
                      border: 'none',
                      color: 'white',
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.2s, transform 0.2s'
                    }}
                    onMouseOver={e => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)';
                      e.currentTarget.style.transform = 'scale(1.1)';
                    }}
                    onMouseOut={e => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    <Plus size={16} />
                  </button>
                  <X size={18} style={{ cursor: 'pointer' }} onClick={() => setIsChatOpen(false)} />
                </div>
              </div>
              <div className="chat-messages">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`chat-message ${msg.role}`}>
                    {msg.text}
                  </div>
                ))}
                {isChatLoading && (
                  <div className="chat-message bot" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Loader2 size={16} className="animate-spin" /> Thinking...
                  </div>
                )}
              </div>
              <form onSubmit={handleSendMessage} className="chat-input-area">
                <input 
                  type="text" 
                  className="chat-input" 
                  placeholder="e.g. create a VCN named test01 in Compartment X..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  disabled={isChatLoading}
                />
                <button type="submit" className="btn btn-primary" style={{ padding: '0.75rem' }} disabled={isChatLoading}>
                  <Send size={16} />
                </button>
              </form>
            </div>
          )}
        </>
      )}

      {/* Task Details Side Drawer */}
      {selectedTask && (
        <div className="log-drawer glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Task Execution Log</h3>
            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setSelectedTask(null)} />
          </div>
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem', fontSize: '0.9rem' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>Task ID:</strong>
              <span style={{ fontFamily: 'monospace' }}>{selectedTask.id}</span>
              
              <strong style={{ color: 'var(--text-secondary)' }}>Workflow ID:</strong>
              <span style={{ fontFamily: 'monospace' }}>{selectedTask.workflow_id}</span>
              
              <strong style={{ color: 'var(--text-secondary)' }}>Status:</strong>
              <span className={`status-indicator ${selectedTask.status}`} style={{ alignSelf: 'start' }}>{selectedTask.status}</span>
              
              <strong style={{ color: 'var(--text-secondary)' }}>Added:</strong>
              <span>{selectedTask.resources_added} resources</span>
            </div>
          </div>
          
          <h4 style={{ margin: '1rem 0 0.5rem 0', color: 'var(--text-secondary)' }}>Terraform Stdout Output</h4>
          <div className="log-content">
            {selectedTask.output_log || 'No standard output recorded.'}
          </div>

          {selectedTask.error_log && (
            <>
              <h4 style={{ margin: '1rem 0 0.5rem 0', color: 'var(--error-color)' }}>Execution Errors</h4>
              <div className="log-content" style={{ color: 'var(--error-color)', background: 'rgba(239, 68, 68, 0.05)' }}>
                {selectedTask.error_log}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

;
