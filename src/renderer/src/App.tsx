import { useState } from 'react'
import PlanView from './components/PlanView'
import SettingsView from './components/SettingsView'

type View = 'plan' | 'settings'

function App(): React.JSX.Element {
  const [currentView, setCurrentView] = useState<View>('plan')

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <nav className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex gap-4">
          <button
            onClick={() => setCurrentView('plan')}
            className={`pb-1 border-b-2 ${
              currentView === 'plan'
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            🗓️ 训练计划
          </button>
        </div>
        <button
          onClick={() => setCurrentView('settings')}
          className={`p-2 ${
            currentView === 'settings' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </nav>

      <div className="flex-1 overflow-hidden">
        {currentView === 'plan' && <PlanView />}
        {currentView === 'settings' && <SettingsView onClose={() => setCurrentView('plan')} />}
      </div>
    </div>
  )
}

export default App
