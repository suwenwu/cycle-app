import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const electronApp = {
  ...electronAPI,
  intervals: {
    fetchWellness: (days: number) => ipcRenderer.invoke('intervals:fetchWellness', days),
    fetchActivities: (startDate: string, endDate: string) =>
      ipcRenderer.invoke('intervals:fetchActivities', startDate, endDate),
    fetchPowerCurves: () => ipcRenderer.invoke('intervals:fetchPowerCurves'),
    fetchGear: () => ipcRenderer.invoke('intervals:fetchGear')
  },
  coach: {
    getContext: (forceRefresh = false) => ipcRenderer.invoke('coach:getContext', forceRefresh),
    setWeeklyStyle: (style: string | null) => ipcRenderer.invoke('coach:setWeeklyStyle', style)
  },
  plan: {
    generate: (style?: string, startDate?: string, endDate?: string) =>
      ipcRenderer.invoke('plan:generate', style, startDate, endDate),
    push: (plan: Record<string, unknown>) => ipcRenderer.invoke('plan:push', plan),
    delete: (eventIds: string[]) => ipcRenderer.invoke('plan:delete', eventIds)
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (config: Record<string, unknown>) => ipcRenderer.invoke('config:set', config),
    getCurrentModel: () => ipcRenderer.invoke('config:getCurrentModel'),
    setCurrentModel: (provider: string, model: string) =>
      ipcRenderer.invoke('config:setCurrentModel', provider, model)
  },
  llm: {
    test: (provider: Record<string, unknown>, model: string) =>
      ipcRenderer.invoke('llm:test', provider, model),
    fetchModels: (baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke('llm:fetchModels', baseUrl, apiKey)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronApp)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronApp
}
