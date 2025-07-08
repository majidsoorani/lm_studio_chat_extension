
// Listen for messages from the popup script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Check if the message type is to send a chat message
  if (request.type === 'SEND_CHAT_MESSAGE') {
    const prompt = request.prompt;
    const model = request.model; // Get the selected model from the request

    // Define the LM Studio API endpoint for chat completions
    const apiUrl = 'http://127.0.0.1:1234/v1/chat/completions';

    // Make a POST request to the LM Studio API
    fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // The messages array should reflect the chat history for context
        // For simplicity, we'll send only the current user message here.
        // For a full conversation, you'd pass the entire chat history.
        messages: [
          { role: 'user', content: prompt }
        ],
        model: model, // Use the selected model
        temperature: 0.7, // Example parameter
        max_tokens: 150, // Example parameter
        stream: false // LM Studio supports streaming, but for simplicity, we'll use non-streaming
      }),
    })
    .then(response => {
      if (!response.ok) {
        // If the response is not OK (e.g., 404, 500), throw an error
        return response.json().then(err => { throw new Error(err.message || 'API request failed'); });
      }
      return response.json();
    })
    .then(data => {
      // Extract the model's response text
      const aiResponse = data.choices[0]?.message?.content || 'No response found.';
      // Send the AI's response back to the popup script
      chrome.runtime.sendMessage({ type: 'CHAT_RESPONSE', text: aiResponse });
    })
    .catch(error => {
      // Log and send error message back to the popup
      console.error('Error calling LM Studio API:', error);
      chrome.runtime.sendMessage({ type: 'CHAT_ERROR', error: error.message });
    });

    // Return true to indicate that sendResponse will be called asynchronously
    return true;
  }
});