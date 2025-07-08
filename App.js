import React, { useState, useEffect, useRef } from 'react';

// Main App component for the Chrome extension popup
const App = () => {
  // State to store chat messages
  const [messages, setMessages] = useState([]);
  // State to store the current input from the user
  const [input, setInput] = useState('');
  // State to indicate if a response is being loaded
  const [loading, setLoading] = useState(false);
  // State to store the selected model (default to 'default-model' or a common LM Studio model name)
  const [selectedModel, setSelectedModel] = useState('default-model'); // User can change this in LM Studio UI

  // Ref for the chat messages container to enable auto-scrolling
  const messagesEndRef = useRef(null);

  // Effect to scroll to the bottom of the chat when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Effect to load the selected model from storage when the component mounts
  useEffect(() => {
    if (chrome.storage) {
      chrome.storage.local.get(['selectedModel'], (result) => {
        if (result.selectedModel) {
          setSelectedModel(result.selectedModel);
        }
      });
    }
  }, []);

  // Effect to listen for messages from the background script
  useEffect(() => {
    if (chrome.runtime) {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'CHAT_RESPONSE') {
          // Add the AI's response to the messages
          setMessages((prevMessages) => [
            ...prevMessages,
            { sender: 'AI', text: request.text },
          ]);
          setLoading(false); // Stop loading indicator
        } else if (request.type === 'CHAT_ERROR') {
          // Handle errors from the background script
          setMessages((prevMessages) => [
            ...prevMessages,
            { sender: 'System', text: `Error: ${request.error}`, isError: true },
          ]);
          setLoading(false); // Stop loading indicator
        }
      });
    }
  }, []);

  // Function to send a message to the background script
  const sendMessage = () => {
    if (!input.trim()) return; // Don't send empty messages

    const userMessage = { sender: 'You', text: input };
    setMessages((prevMessages) => [...prevMessages, userMessage]); // Add user's message to chat
    setLoading(true); // Start loading indicator
    setInput(''); // Clear input field

    if (chrome.runtime) {
      // Send the message and selected model to the background script
      chrome.runtime.sendMessage(
        {
          type: 'SEND_CHAT_MESSAGE',
          prompt: input,
          model: selectedModel,
        },
        (response) => {
          // This callback is for immediate acknowledgment, actual response comes via onMessage listener
          if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError.message);
            setMessages((prevMessages) => [
              ...prevMessages,
              { sender: 'System', text: `Failed to send: ${chrome.runtime.lastError.message}`, isError: true },
            ]);
            setLoading(false);
          }
        }
      );
    } else {
      // Fallback for development outside of Chrome extension environment
      console.warn('chrome.runtime not available. Simulating response.');
      setLoading(true);
      setTimeout(() => {
        setMessages((prevMessages) => [
          ...prevMessages,
          { sender: 'AI', text: `(Simulated) You said: "${input}"` },
        ]);
        setLoading(false);
      }, 1000);
    }
  };

  // Function to handle changes in the model selection dropdown
  const handleModelChange = (e) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    if (chrome.storage) {
      chrome.storage.local.set({ selectedModel: newModel }, () => {
        console.log('Model saved:', newModel);
      });
    }
  };

  // Function to handle key presses (e.g., Enter to send message)
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevent new line in textarea
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[500px] w-[350px] bg-gray-50 rounded-lg shadow-lg overflow-hidden font-inter">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-600 to-purple-700 text-white shadow-md rounded-t-lg">
        <h1 className="text-xl font-bold">LM Studio Chat</h1>
        <div className="relative">
          <select
            value={selectedModel}
            onChange={handleModelChange}
            className="appearance-none bg-blue-700 text-white py-1 px-3 pr-8 rounded-md shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer text-sm"
          >
            {/* These models are placeholders. User needs to select the active model in LM Studio UI. */}
            <option value="default-model">Default Model</option>
            <option value="llama-2-7b-chat.Q4_K_M.gguf">Llama 2 7B Chat</option>
            <option value="mistral-7b-instruct-v0.2.Q4_K_M.gguf">Mistral 7B Instruct</option>
            <option value="gemma-2b-it.Q4_K_M.gguf">Gemma 2B IT</option>
            {/* Add more options as needed, or dynamically fetch them if LM Studio API allows */}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-white">
            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 6.757 7.586 5.343 9z"/></svg>
          </div>
        </div>
      </div>

      {/* Chat Messages Area */}
      <div className="flex-1 p-4 overflow-y-auto bg-white custom-scrollbar">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-10">
            Start a conversation with your LM Studio model!
          </div>
        )}
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex mb-3 ${
              msg.sender === 'You' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-xl shadow-sm ${
                msg.sender === 'You'
                  ? 'bg-blue-500 text-white rounded-br-none'
                  : 'bg-gray-200 text-gray-800 rounded-bl-none'
              } ${msg.isError ? 'bg-red-200 text-red-800' : ''}`}
            >
              <span className="font-semibold text-sm">{msg.sender}:</span>{' '}
              <p className="text-sm break-words whitespace-pre-wrap">{msg.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start mb-3">
            <div className="max-w-[80%] p-3 rounded-xl bg-gray-200 text-gray-800 rounded-bl-none shadow-sm">
              <span className="font-semibold text-sm">AI:</span>{' '}
              <p className="text-sm animate-pulse">Thinking...</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} /> {/* Scroll target */}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-gray-100 border-t border-gray-200 flex items-center rounded-b-lg">
        <textarea
          className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none h-12 overflow-hidden text-sm"
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          rows="1"
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="ml-3 p-3 bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200 ease-in-out transform hover:scale-105"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-send"
          >
            <path d="m22 2-7 20-4-9-9-4 20-7z" />
            <path d="M15 7l-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default App;
