
// Default API settings
const DEFAULT_API_SETTINGS = {
  apiUrl: 'http://127.0.0.1:1234/v1',
  temperature: 0.7,
  maxTokens: 1024,
  currentSystemPrompt: '', // Default empty system prompt
};

// Helper function to get API settings from storage
async function getApiSettings() {
  try {
    // Ensure chrome.storage.local is available
    if (chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get('apiSettings');
      return { ...DEFAULT_API_SETTINGS, ...result.apiSettings };
    }
    console.warn("chrome.storage.local not available, using default API settings.");
    return DEFAULT_API_SETTINGS;
  } catch (error) {
    console.error("Error retrieving API settings, using defaults:", error);
    return DEFAULT_API_SETTINGS;
  }
}


// Listen for messages from the popup script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_MODELS') {
    getApiSettings().then(settings => {
      fetch(`${settings.apiUrl}/models`)
        .then(response => {
          if (!response.ok) {
            // Try to parse JSON error from LM Studio if possible
            return response.json().then(err => {
              throw new Error(err.error?.message || err.message || `Failed to fetch models (${response.status})`);
            }).catch(() => { // Fallback if error body isn't JSON or parsing fails
              throw new Error(`Failed to fetch models (${response.status} ${response.statusText || 'Server error'})`);
            });
          }
          return response.json();
        })
        .then(data => {
          // Ensure data.data is an array before mapping
          const models = (Array.isArray(data.data) ? data.data : []).map(model => ({ id: model.id }));
          chrome.runtime.sendMessage({ type: 'MODELS_LIST', models: models });
        })
        .catch(error => {
          console.error('Error fetching models from LM Studio:', error);
          chrome.runtime.sendMessage({ type: 'MODELS_ERROR', error: error.message });
        });
    });
    return true; // Indicate asynchronous response
  }
  // Check if the message type is to send a chat message
  else if (request.type === 'SEND_CHAT_MESSAGE') {
    getApiSettings().then(settings => {
      // const userPrompt = request.prompt; // Not directly used if history contains the latest
      const model = request.model;
      const historyFromApp = request.history || [];

      let apiMessages = [];

      // Add system prompt if it exists
      if (settings.currentSystemPrompt && settings.currentSystemPrompt.trim() !== '') {
        apiMessages.push({ role: 'system', content: settings.currentSystemPrompt.trim() });
      }

      // Add transformed history
      const formattedHistory = historyFromApp
        .filter(msg => msg.sender === 'You' || msg.sender === 'AI')
        .map(msg => ({
          role: msg.sender === 'You' ? 'user' : 'assistant',
          content: msg.text
        }));
      apiMessages = apiMessages.concat(formattedHistory);

      // Define the LM Studio API endpoint for chat completions
      const apiUrl = `${settings.apiUrl}/chat/completions`;

      // Make a POST request to the LM Studio API
      fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: apiMessages, // Send the formatted history
          model: model,
          temperature: settings.temperature, // Use stored temperature
          max_tokens: settings.maxTokens,    // Use stored max_tokens
          stream: true // Enable streaming
        }),
      })
      .then(response => {
        if (!response.ok) {
          return response.json().then(err => {
            let errorMessage = 'API request failed';
            if (err && err.error && err.error.message) {
              errorMessage = err.error.message;
            } else if (err && err.message) {
              errorMessage = err.message;
            } else {
              errorMessage = `API Error: ${response.status} ${response.statusText || ''}`;
            }
            throw new Error(errorMessage.trim());
          }).catch(() => { // Fallback if error body isn't JSON
             throw new Error(`API Error: ${response.status} ${response.statusText || 'Server error'}`);
          });
        }
        // Handle the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let partialResponse = '';
        let messageId = `ai_${Date.now()}`; // Unique ID for this streaming message

        // Send an initial message to indicate streaming has started
        chrome.runtime.sendMessage({ type: 'CHAT_STREAM_START', messageId: messageId });

        function push() {
          reader.read().then(({ done, value }) => {
            if (done) {
              chrome.runtime.sendMessage({ type: 'CHAT_STREAM_END', messageId: messageId });
              return;
            }
            partialResponse += decoder.decode(value, { stream: true });

            // Process lines from the stream
            let lines = partialResponse.split('\n');
            partialResponse = lines.pop(); // Keep the last (potentially incomplete) line

            lines.forEach(line => {
              if (line.startsWith('data: ')) {
                const jsonStr = line.substring(6);
                if (jsonStr === '[DONE]') {
                  // This is a common stream termination signal
                  // Handled by reader.read() done, but good to be aware of
                  return;
                }
                try {
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.choices && parsed.choices[0]?.delta?.content) {
                    const chunk = parsed.choices[0].delta.content;
                    chrome.runtime.sendMessage({ type: 'CHAT_STREAM_CHUNK', messageId: messageId, chunk: chunk });
                  }
                } catch (e) {
                  console.error('Error parsing stream JSON:', e, jsonStr);
                }
              }
            });
            push();
          }).catch(streamError => {
            console.error('Error reading stream:', streamError);
            chrome.runtime.sendMessage({ type: 'CHAT_ERROR', error: streamError.message });
            chrome.runtime.sendMessage({ type: 'CHAT_STREAM_END', messageId: messageId, error: true });
          });
        }
        push();
      })
      .catch(error => {
        console.error('Error calling LM Studio API (streaming):', error);
        chrome.runtime.sendMessage({ type: 'CHAT_ERROR', error: error.message });
      });
    });
    return true; // Indicate asynchronous response
  }
});