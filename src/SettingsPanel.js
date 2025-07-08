import React, { useState, useEffect } from 'react';

const SettingsPanel = ({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  savedPersonas,
  onSavePersona,
  onDeletePersona
}) => {
  const [currentPersonaName, setCurrentPersonaName] = useState('');
  const [selectedPersonaId, setSelectedPersonaId] = useState('');

  useEffect(() => {
    // If currentSystemPrompt matches a saved persona's prompt, select it in dropdown
    // and prefill the name field.
    const matchedPersona = savedPersonas.find(p => p.prompt === settings.currentSystemPrompt);
    if (matchedPersona) {
      setSelectedPersonaId(matchedPersona.id);
      setCurrentPersonaName(matchedPersona.name);
    } else {
      setSelectedPersonaId('');
      // setCurrentPersonaName(''); // Keep name if user is editing a custom prompt based on a persona
    }
  }, [settings.currentSystemPrompt, savedPersonas, isOpen]); // Re-run if panel opens

  // Update persona name field if a persona is selected from dropdown
  useEffect(() => {
    if (selectedPersonaId) {
        const persona = savedPersonas.find(p => p.id === selectedPersonaId);
        if (persona) {
            setCurrentPersonaName(persona.name);
        }
    } else {
        // If no persona is selected (e.g. "Select a persona..."), clear the name field
        // only if the current prompt isn't a custom one.
        // This logic can be tricky; for now, let's just clear if selection is cleared.
        // setCurrentPersonaName('');
    }
  }, [selectedPersonaId, savedPersonas]);


  if (!isOpen) {
    return null;
  }

  const handleSettingValueChange = (e) => {
    const { name, value, type, checked } = e.target;
    onSettingsChange(name, type === 'checkbox' ? checked : (type === 'number' ? parseFloat(value) : value));
  };

  const handleClosePanel = () => {
    onClose();
  };

  const handleSaveCurrentPersona = () => {
    if (onSavePersona(currentPersonaName, settings.currentSystemPrompt)) {
      // After saving, find the (potentially new/updated) persona and select it
      const justSavedPersona = savedPersonas.find(p=>p.name === currentPersonaName && p.prompt === settings.currentSystemPrompt) ||
                               savedPersonas.find(p=>p.name === currentPersonaName); // fallback by name if prompt was just updated.
      if(justSavedPersona) setSelectedPersonaId(justSavedPersona.id);
    }
  };

  const handleLoadSelectedPersona = () => {
    if (selectedPersonaId) {
      const persona = savedPersonas.find(p => p.id === selectedPersonaId);
      if (persona) {
        onSettingsChange('currentSystemPrompt', persona.prompt);
        setCurrentPersonaName(persona.name);
      }
    }
  };

  const handleDeleteSelectedPersona = () => {
    if (selectedPersonaId) {
      onDeletePersona(selectedPersonaId);
      setSelectedPersonaId('');
      setCurrentPersonaName('');
    } else {
      alert("Please select a persona to delete.");
    }
  };

  return (
    <div className="absolute inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800">Settings</h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="apiUrl" className="block text-sm font-medium text-gray-700 mb-1">
              LM Studio API URL:
            </label>
            <input
              type="text"
              name="apiUrl"
              id="apiUrl"
              value={settings.apiUrl || 'http://127.0.0.1:1234/v1'}
              onChange={handleSettingValueChange}
              className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>

          <div>
            <label htmlFor="temperature" className="block text-sm font-medium text-gray-700 mb-1">
              Temperature: <span className="text-gray-500 text-xs">({settings.temperature || 0.7})</span>
            </label>
            <input
              type="range"
              name="temperature"
              id="temperature"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature || 0.7}
              onChange={handleSettingValueChange}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div>
            <label htmlFor="maxTokens" className="block text-sm font-medium text-gray-700 mb-1">
              Max Tokens: <span className="text-gray-500 text-xs">({settings.maxTokens || 1024})</span>
            </label>
            <input
              type="number"
              name="maxTokens"
              id="maxTokens"
              min="1"
              max="8192"
              step="1"
              value={settings.maxTokens || 1024}
              onChange={handleSettingValueChange}
              className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>

          <hr className="my-6" />
          <h3 className="text-lg font-medium text-gray-800 mb-1">System Prompt / Personas</h3>

          <div className="space-y-3 p-3 border border-gray-200 rounded-md bg-gray-50">
            <div>
              <label htmlFor="savedPersonaSelect" className="block text-xs font-medium text-gray-600 mb-1">
                Manage Saved Personas:
              </label>
              <div className="flex space-x-2">
                <select
                  id="savedPersonaSelect"
                  value={selectedPersonaId}
                  onChange={(e) => setSelectedPersonaId(e.target.value)}
                  className="flex-grow p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="">-- Select Persona --</option>
                  {savedPersonas.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleLoadSelectedPersona}
                  disabled={!selectedPersonaId}
                  className="px-3 py-1.5 bg-green-500 text-white text-xs rounded-md hover:bg-green-600 disabled:opacity-50"
                  title="Load selected persona into current system prompt"
                >
                  Use
                </button>
                <button
                  onClick={handleDeleteSelectedPersona}
                  disabled={!selectedPersonaId}
                  className="px-3 py-1.5 bg-red-500 text-white text-xs rounded-md hover:bg-red-600 disabled:opacity-50"
                  title="Delete selected persona"
                >
                  Delete
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="currentSystemPrompt" className="block text-xs font-medium text-gray-600 mb-1">
                Current System Prompt (edit or type new):
              </label>
              <textarea
                name="currentSystemPrompt"
                id="currentSystemPrompt"
                rows="4"
                value={settings.currentSystemPrompt || ''}
                onChange={handleSettingValueChange}
                placeholder="e.g., You are a helpful assistant that speaks like a pirate."
                className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>

            <div>
              <label htmlFor="personaName" className="block text-xs font-medium text-gray-600 mb-1">
                Persona Name (for saving current prompt):
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  id="personaName"
                  value={currentPersonaName}
                  onChange={(e) => setCurrentPersonaName(e.target.value)}
                  placeholder="Enter persona name to save/update"
                  className="flex-grow p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                <button
                  onClick={handleSaveCurrentPersona}
                  disabled={!currentPersonaName.trim() || !settings.currentSystemPrompt?.trim()}
                  className="px-3 py-1.5 bg-indigo-500 text-white text-xs rounded-md hover:bg-indigo-600 disabled:opacity-50"
                  title="Save or update the current system prompt with this name"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleClosePanel}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
