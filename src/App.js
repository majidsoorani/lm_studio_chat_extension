import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SettingsPanel from './SettingsPanel';

const App = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelError, setModelError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [streamingMessageId, setStreamingMessageId] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [globalApiSettings, setGlobalApiSettings] = useState({ // Renamed
    apiUrl: 'http://127.0.0.1:1234/v1',
    temperature: 0.7,
    maxTokens: 1024,
    // currentSystemPrompt is now per-session
  });
  const [savedPersonas, setSavedPersonas] = useState([]);

  // --- Multi-Session States ---
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);

  // Derived state for the active session's data
  const activeSession = sessions.find(s => s.id === activeSessionId) || null;

  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Helper to get messages for the active session
  const getActiveMessages = () => activeSession?.messages || [];
  const setActiveMessages = (newMessagesOrCallback) => {
    setSessions(prevSessions => prevSessions.map(s => {
      if (s.id === activeSessionId) {
        const currentMessages = s.messages || []; // Ensure currentMessages is an array
        const newMsgs = typeof newMessagesOrCallback === 'function'
          ? newMessagesOrCallback(currentMessages)
          : newMessagesOrCallback;
        return { ...s, messages: newMsgs };
      }
      return s;
    }));
  };

  const setActiveSessionSelectedModel = (modelId) => {
    setSessions(prevSessions => prevSessions.map(s =>
      s.id === activeSessionId ? { ...s, selectedModel: modelId } : s
    ));
  };

  const setActiveSessionSystemPrompt = (promptText) => {
    setSessions(prevSessions => prevSessions.map(s =>
      s.id === activeSessionId ? { ...s, currentSystemPrompt: promptText } : s
    ));
  };

  // Load all data from storage: sessions, activeSessionId, globalApiSettings, savedPersonas
  useEffect(() => {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([
        'sessions',
        'activeSessionId',
        'globalApiSettings', // Changed from 'apiSettings'
        'savedPersonas',
        // 'selectedModel' // No longer global
        // 'chatMessages' // No longer global
      ], (result) => {
        const loadedSessions = result.sessions || [];
        setSessions(loadedSessions);

        if (result.globalApiSettings) {
          setGlobalApiSettings(prev => ({ ...prev, ...result.globalApiSettings }));
        } else if (result.apiSettings) { // Migration from old key
          setGlobalApiSettings(prev => ({
            ...prev,
            apiUrl: result.apiSettings.apiUrl,
            temperature: result.apiSettings.temperature,
            maxTokens: result.apiSettings.maxTokens,
            // currentSystemPrompt from old apiSettings is ignored here, should be part of session
          }));
        }

        if (result.savedPersonas) {
          setSavedPersonas(result.savedPersonas);
        }

        let currentActiveId = result.activeSessionId;
        if (!currentActiveId && loadedSessions.length > 0) {
          currentActiveId = loadedSessions[0].id;
        } else if (loadedSessions.length === 0) {
          const defaultSessionId = `session_${Date.now()}`;
          const defaultSystemPrompt = ''; // Default for new sessions
          const newDefaultSession = {
            id: defaultSessionId,
            name: 'Chat 1',
            messages: [],
            selectedModel: '',
            currentSystemPrompt: defaultSystemPrompt,
          };
          setSessions([newDefaultSession]);
          currentActiveId = defaultSessionId;
          // Initial save for the new default session
          chrome.storage.local.set({ sessions: [newDefaultSession], activeSessionId: defaultSessionId });
        }
        setActiveSessionId(currentActiveId);

        // If migrating from old single selectedModel, apply it to the active session if it's empty.
        if (result.selectedModel && currentActiveId) {
            const activeSess = (loadedSessions.find(s => s.id === currentActiveId)) || (sessions.find(s => s.id === currentActiveId));
            if (activeSess && !activeSess.selectedModel) {
                setActiveSessionSelectedModel(result.selectedModel);
            }
        }
      });
    }
    // Fetch available models
    if (chrome.runtime && chrome.runtime.sendMessage) {
      setConnectionStatus('connecting');
      chrome.runtime.sendMessage({ type: 'GET_MODELS' });
    }
  }, []); // Runs once on mount

  // Effect to save sessions and activeSessionId to storage when they change
  useEffect(() => {
    if (chrome.storage && chrome.storage.local) {
      if (sessions.length > 0 && activeSessionId) {
         chrome.storage.local.set({ sessions: sessions, activeSessionId: activeSessionId });
      } else if (sessions.length === 0 && !activeSessionId) {
        chrome.storage.local.remove(['sessions', 'activeSessionId']);
      }
    }
  }, [sessions, activeSessionId]);

  // Save globalApiSettings when they change
  useEffect(() => {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ globalApiSettings: globalApiSettings });
    }
  }, [globalApiSettings]);

  // Listener for messages from background script
  useEffect(() => {
    if (!activeSessionId) return; // Don't set up listeners if no active session

    if (chrome.runtime && chrome.runtime.onMessage) {
      const messageListener = (request, sender, sendResponse) => {
        if (request.type === 'CHAT_STREAM_START') {
          setActiveMessages((prev) => [...(prev || []), { id: request.messageId, sender: 'AI', text: '', isStreaming: true }]);
          setStreamingMessageId(request.messageId);
          setLoading(true);
          setConnectionStatus('connected');
        } else if (request.type === 'CHAT_STREAM_CHUNK') {
          setActiveMessages((prev) => (prev || []).map((msg) => msg.id === request.messageId ? { ...msg, text: msg.text + request.chunk } : msg));
        } else if (request.type === 'CHAT_STREAM_END') {
          setActiveMessages((prev) => (prev || []).map((msg) => msg.id === request.messageId ? { ...msg, isStreaming: false } : msg));
          setStreamingMessageId(null);
          setLoading(false);
          if (request.error) setConnectionStatus('error');
        } else if (request.type === 'CHAT_ERROR') {
          setActiveMessages((prev) => [...(prev || []), { id: `sys_${Date.now()}`, sender: 'System', text: `Error: ${request.error}`, isError: true }]);
          setLoading(false);
          setConnectionStatus('error');
          setStreamingMessageId(null);
        } else if (request.type === 'MODELS_LIST') {
          setAvailableModels(request.models || []);
          setModelError('');
          setConnectionStatus('connected');
          if (request.models && request.models.length > 0) {
            const currentActiveSess = sessions.find(s => s.id === activeSessionId); // Get up-to-date session
            const currentSelectedModelIsValid = request.models.some(m => m.id === currentActiveSess?.selectedModel);
            if (!currentActiveSess?.selectedModel || !currentSelectedModelIsValid) {
              setActiveSessionSelectedModel(request.models[0].id);
            }
          } else if (sessions.find(s => s.id === activeSessionId)?.selectedModel) {
             setActiveSessionSelectedModel('');
          }
        } else if (request.type === 'MODELS_ERROR') {
          setModelError(request.error);
          setAvailableModels([]);
          setConnectionStatus('error');
        }
      };
      chrome.runtime.onMessage.addListener(messageListener);
      return () => chrome.runtime.onMessage.removeListener(messageListener);
    }
  }, [activeSessionId, sessions]); // Added sessions as dependency for selectedModel logic

  // Renamed from handleSettingsChange to avoid confusion, this handles GLOBAL settings
  const handleGlobalSettingsChange = (settingName, value) => {
    // If 'currentSystemPrompt' is passed here, it means it's from the direct textarea edit,
    // and should apply to the active session's system prompt.
    if (settingName === 'currentSystemPrompt') {
      setActiveSessionSystemPrompt(value);
    } else {
      setGlobalApiSettings(prevSettings => {
        const newSettings = { ...prevSettings, [settingName]: value };
        // chrome.storage.local.set({ globalApiSettings: newSettings }); // This is handled by its own useEffect
        if (settingName === 'apiUrl') {
          setAvailableModels([]);
          setModelError('');
          setConnectionStatus('idle');
          if (chrome.runtime?.sendMessage) {
              setConnectionStatus('connecting');
              chrome.runtime.sendMessage({ type: 'GET_MODELS' });
          }
        }
        return newSettings;
      });
  };

  const handleAddNewSession = () => {
    setSessions(prevSessions => {
      const newSessionName = `Chat ${prevSessions.length + 1}`;
      const newSessionId = `session_${Date.now()}`;
      const newSession = {
        id: newSessionId,
        name: newSessionName,
        messages: [],
        selectedModel: activeSession?.selectedModel || '', // Inherit model from current, or default
        currentSystemPrompt: activeSession?.currentSystemPrompt || '', // Inherit system prompt
      };
      const updatedSessions = [...prevSessions, newSession];
      setActiveSessionId(newSessionId); // Switch to the new session
      // Storage update will be handled by the useEffect watching 'sessions' and 'activeSessionId'
      return updatedSessions;
    });
  };

  const handleSwitchSession = (sessionId) => {
    if (sessions.find(s => s.id === sessionId)) {
      setActiveSessionId(sessionId);
    }
  };

  const handleRenameSession = (sessionId, newName) => {
    if (!newName.trim()) {
      alert("Session name cannot be empty.");
      return;
    }
    setSessions(prevSessions =>
      prevSessions.map(s => s.id === sessionId ? { ...s, name: newName.trim() } : s)
    );
    // Storage update handled by useEffect
  };

  const handleDeleteSession = (sessionIdToDelete) => {
    if (sessions.length <= 1) {
      alert("Cannot delete the last session.");
      return;
    }
    if (!window.confirm(`Are you sure you want to delete session: ${sessions.find(s=>s.id === sessionIdToDelete)?.name}?`)) {
        return;
    }
    setSessions(prevSessions => {
      const updatedSessions = prevSessions.filter(s => s.id !== sessionIdToDelete);
      if (activeSessionId === sessionIdToDelete) {
        // If active session is deleted, switch to the first available session
        setActiveSessionId(updatedSessions.length > 0 ? updatedSessions[0].id : null);
      }
      return updatedSessions;
    });
    // Storage update handled by useEffect
  };

  const handleSavePersona = (name, prompt) => {
    if (!name || !prompt) {
      alert("Persona name and prompt text are required to save.");
      return false;
    }
    setSavedPersonas(prevPersonas => {
      const existingPersonaIndex = prevPersonas.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
      let newPersonas;
      const personaData = { id: existingPersonaIndex !== -1 ? prevPersonas[existingPersonaIndex].id : `persona_${Date.now()}`, name, prompt };

      if (existingPersonaIndex !== -1) {
        if (!window.confirm(`A persona named "${name}" already exists. Overwrite it?`)) {
          return prevPersonas;
        }
        newPersonas = prevPersonas.map((p, index) =>
          index === existingPersonaIndex ? personaData : p
        );
      } else {
        newPersonas = [...prevPersonas, personaData];
      }
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ savedPersonas: newPersonas });
      }
      return newPersonas;
    });
    return true;
  };

  const handleDeletePersona = (personaId) => {
    if (!window.confirm("Are you sure you want to delete this persona?")) {
      return;
    }
    setSavedPersonas(prevPersonas => {
      const newPersonas = prevPersonas.filter(p => p.id !== personaId);
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ savedPersonas: newPersonas });
      }
      const deletedPersona = prevPersonas.find(p => p.id === personaId);
      if (activeSession && deletedPersona && activeSession.currentSystemPrompt === deletedPersona.prompt) {
        // If the active system prompt was the one deleted, clear it for the current session
        setActiveSessionSystemPrompt('');
      }
      return newPersonas;
    });
  };

  const copyToClipboard = (text, messageId) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 1500);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      // Use setActiveMessages for the currently active session
      setActiveMessages(prev => [...(prev || []), {id: `sys_${Date.now()}`, sender: "System", text: "Failed to copy text.", isError: true}]);
    });
  };

  const sendMessage = () => {
    if (!input.trim() || !activeSession?.selectedModel) {
      if (!activeSession?.selectedModel && availableModels.length > 0) {
        setActiveMessages(prev => [...(prev || []), { id: `sys_${Date.now()}`, sender: 'System', text: 'Please select a model first.', isError: true }]);
      }
      return;
    }
    const userMessage = { id: `user_${Date.now()}`, sender: 'You', text: input };
    setActiveMessages(prev => [...(prev || []), userMessage]);
    setLoading(true);

    // Get current messages for history AFTER adding the new userMessage to the session
    const currentMessagesForHistory = sessions.find(s => s.id === activeSessionId)?.messages || [];
    const history = currentMessagesForHistory.slice(-11); // send up to 10 previous + current user message

    if (chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'SEND_CHAT_MESSAGE',
        prompt: userMessage.text, // Use the actual text from userMessage
        model: activeSession.selectedModel,
        history: history,
        systemPrompt: activeSession.currentSystemPrompt
      });
    } else {
      console.warn('chrome.runtime not available. Simulating response.');
      setTimeout(() => {
        setActiveMessages(prev => [...(prev || []), { id: `ai_sim_${Date.now()}`, sender: 'AI', text: `(Simulated) You said: "${input}"` }]);
        setLoading(false);
      }, 1000);
    }
    setInput('');
  };

  const handleModelChange = (e) => {
    const newModel = e.target.value;
    setActiveSessionSelectedModel(newModel);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClearChat = () => {
    if (window.confirm('Are you sure you want to clear the chat history for this session?')) {
      setActiveMessages([]); // Clears messages for the active session
    }
  };

  // Render current session's messages
  const currentMessages = getActiveMessages();

  return (
    <div className="flex flex-col h-[500px] w-[350px] bg-gray-50 rounded-lg shadow-lg overflow-hidden font-inter">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-600 to-purple-700 text-white shadow-md rounded-t-lg">
        <div className="flex items-center space-x-2">
          {/* Session Dropdown */}
          <div className="relative group">
            <select
              value={activeSessionId || ''}
              onChange={(e) => handleSwitchSession(e.target.value)}
              className="text-sm appearance-none bg-blue-700 hover:bg-blue-800 text-white py-1 pl-2 pr-6 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer max-w-[120px] truncate"
              title={activeSession?.name || "Select Session"}
            >
              {sessions.map(session => (
                <option key={session.id} value={session.id} title={session.name}>
                  {session.name}
                </option>
              ))}
            </select>
             <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 text-white">
                <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 6.757 7.586 5.343 9z"/></svg>
            </div>
          </div>
           {/* Session Action Buttons - could be a dropdown menu for more actions */}
          <button onClick={handleAddNewSession} title="New Chat Session" className="p-1 hover:bg-blue-500 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
           {/* Simple Rename - prompt for now */}
          <button
            onClick={() => {
                const newName = prompt("Enter new name for current session:", activeSession?.name);
                if (newName && activeSessionId) handleRenameSession(activeSessionId, newName);
            }}
            disabled={!activeSessionId}
            title="Rename Current Session" className="p-1 hover:bg-blue-500 rounded-full disabled:opacity-50"
            >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <span // Connection Status
            title={connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
            className={`h-3 w-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400' : ''} ${connectionStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : ''} ${connectionStatus === 'error' ? 'bg-red-400' : ''} ${connectionStatus === 'idle' ? 'bg-gray-400' : ''}`}
          ></span>
        </div>
        <div className="flex items-center">
          <button onClick={handleClearChat} title="Clear chat history" className="mr-2 p-1.5 text-white hover:bg-blue-500 rounded-full focus:outline-none focus:ring-1 focus:ring-blue-300" disabled={currentMessages.length === 0 && !loading}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
          </button>
          <button onClick={() => setIsSettingsOpen(true)} title="Settings" className="ml-1 p-1.5 text-white hover:bg-blue-500 rounded-full focus:outline-none focus:ring-1 focus:ring-blue-300">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
          <div className="relative">
            <select value={activeSession?.selectedModel || ''} onChange={handleModelChange} disabled={availableModels.length === 0 && !modelError} className="appearance-none bg-blue-700 text-white py-1 px-3 pr-8 rounded-md shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer text-sm disabled:opacity-70 disabled:cursor-not-allowed">
              {modelError && <option value="" disabled>Error loading models</option>}
              {!modelError && availableModels.length === 0 && <option value="" disabled>Loading models...</option>}
              {!modelError && availableModels.length > 0 && !activeSession?.selectedModel && <option value="" disabled>Select a model</option>}
              {availableModels.map((model) => (<option key={model.id} value={model.id}>{model.id}</option>))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-white">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 6.757 7.586 5.343 9z"/></svg>
            </div>
          </div>
        </div>
      </div>

      {modelError && (<div className="p-2 bg-red-100 text-red-700 text-xs text-center">Failed to load models: {modelError}. Ensure LM Studio is running and server is on.</div>)}

      <div className="flex-1 p-4 overflow-y-auto bg-white custom-scrollbar">
        {currentMessages.length === 0 && !loading && connectionStatus === 'error' && (
          <div className="text-center text-gray-600 mt-10 p-3 bg-yellow-100 border border-yellow-300 rounded-md">
            <p className="font-semibold">Connection Issue</p>
            <p className="text-sm">Could not connect to LM Studio or load models.</p>
            <p className="text-xs mt-2">Please ensure:<ul className="list-disc list-inside text-left w-fit mx-auto mt-1"><li>LM Studio is running.</li><li>The API server is started in LM Studio.</li><li>A model is loaded in LM Studio.</li></ul></p>
            {modelError && <p className="text-xs mt-1 text-red-500">Details: {modelError}</p>}
          </div>
        )}
        {currentMessages.length === 0 && !loading && connectionStatus !== 'error' && (
          <div className="text-center text-gray-500 mt-10">
            {availableModels.length === 0 && connectionStatus === 'connecting' ? "Loading models..." : ""}
            {availableModels.length === 0 && connectionStatus === 'connected' && !modelError ? "No models available from LM Studio." : ""}
            {availableModels.length > 0 && activeSession?.selectedModel ? "Start a conversation!" : ""}
            {availableModels.length > 0 && !activeSession?.selectedModel ? "Please select a model to begin." : ""}
            {connectionStatus === 'idle' ? "Initializing..." : ""}
          </div>
        )}
        {currentMessages.map((msg, index) => (
          <div key={msg.id || index} className={`flex mb-3 group ${msg.sender === 'You' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-xl shadow-sm ${msg.sender === 'You' ? 'bg-blue-500 text-white rounded-br-none' : 'bg-gray-200 text-gray-800 rounded-bl-none'} ${msg.isError ? 'bg-red-200 text-red-800' : ''}`}>
              <span className="font-semibold text-sm">{msg.sender}:</span>{' '}
              {msg.sender === 'AI' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm max-w-none break-words whitespace-pre-wrap" components={{ a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300" />, p: ({node, ...props}) => <p {...props} className="mb-0" />, }}>
                  {msg.text}
                </ReactMarkdown>
              ) : ( <p className="text-sm break-words whitespace-pre-wrap">{msg.text}</p> )}
            </div>
            {!msg.isStreaming && msg.text && (msg.sender === 'AI' || msg.sender === 'You') && (
              <button onClick={() => copyToClipboard(msg.text, msg.id)} title="Copy text" className={`ml-2 p-1 rounded-full group-hover:opacity-100 ${copiedMessageId === msg.id ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200 ${msg.sender === 'You' ? 'text-blue-200 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                {copiedMessageId === msg.id ? (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>) : (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>)}
              </button>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-gray-100 border-t border-gray-200 flex items-center rounded-b-lg">
        <textarea className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none h-12 overflow-hidden text-sm" placeholder="Type your message..." value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={handleKeyPress} rows="1" />
        <button onClick={sendMessage} disabled={loading || !input.trim() || !activeSession?.selectedModel} className="ml-3 p-3 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200 ease-in-out transform hover:scale-105">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-send"><path d="m22 2-7 20-4-9-9-4 20-7z" /><path d="M15 7l-6 6" /></svg>
        </button>
      </div>
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
         settings={{ ...globalApiSettings, currentSystemPrompt: activeSession?.currentSystemPrompt || '' }}
         onSettingsChange={handleGlobalSettingsChange} // Changed to global handler
         savedPersonas={savedPersonas}
         onSavePersona={handleSavePersona}
         onDeletePersona={handleDeletePersona}
      />
    </div>
  );
};

export default App;
