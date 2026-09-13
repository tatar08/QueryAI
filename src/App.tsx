import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { MainLayout } from "./components/layout/MainLayout";
import { ConnectionLayoutProvider } from "./contexts/ConnectionLayoutProvider";
import { RightSidebarProvider } from "./contexts/RightSidebarProvider";
import { KeybindingsProvider } from "./contexts/KeybindingsProvider";
import { PluginSlotProvider } from "./contexts/PluginSlotProvider";
import { PluginModalProvider } from "./contexts/PluginModalProvider";
import { AlertProvider } from "./contexts/AlertProvider";
import { Connections } from "./pages/Connections";
import { Editor } from "./pages/Editor";
import { McpPage } from "./pages/McpPage";
import { Settings } from "./pages/Settings";
import { MonitorPage } from "./pages/Monitor";
import { SchemaDiagramPage } from "./pages/SchemaDiagramPage";
import { TaskManagerPage } from "./pages/TaskManagerPage";
import { VisualExplainPage } from "./pages/VisualExplainPage";
import { JsonViewerPage } from "./pages/JsonViewerPage";
import { ResultsWindowPage } from "./pages/ResultsWindowPage";
import { ConnectionHealthMonitor } from "./components/ConnectionHealthMonitor";
import { EditorErrorBoundary } from "./components/ui/EditorErrorBoundary";
import { UpdateNotificationModal } from "./components/modals/UpdateNotificationModal";
import { CommunityModal } from "./components/modals/CommunityModal";
import { WhatsNewModal } from "./components/modals/WhatsNewModal";
import { AiApprovalGate } from "./components/modals/AiApprovalGate";
import { PluginInstallConfirmModal } from "./components/modals/PluginInstallConfirmModal";
import { SshAskpassGate } from "./components/modals/SshAskpassGate";
import { TeamMembersModal } from "./components/modals/TeamMembersModal";
import { DesignSystemModal } from "./components/modals/DesignSystemModal";
import { PostgresToolsModal } from "./components/modals/PostgresToolsModal";
import { SqliteToolsModal } from "./components/modals/SqliteToolsModal";
import { PinAuthModal } from "./components/modals/PinAuthModal";
import { DatabaseMonitorModal } from "./components/modals/DatabaseMonitorModal";
import { useWorkspace } from "./contexts/WorkspaceContext";
import { useUpdate } from "./hooks/useUpdate";
import { useChangelog } from "./hooks/useChangelog";
import { useSettings } from "./hooks/useSettings";
import { useDeepLinkInstall } from "./hooks/useDeepLinkInstall";
import { useResultTypeColors } from "./hooks/useResultTypeColors";
import { APP_VERSION } from "./version";
import { isVersionAtMost, isVersionNewer } from "./utils/versionCompare";

const WHATS_NEW_VERSION_KEY = "tabularis_last_seen_version";

export function App() {
  const {
    updateInfo,
    isDownloading,
    downloadProgress,
    downloadAndInstall,
    dismissUpdate,
    error: updateError,
  } = useUpdate();
  const { isTeamModalOpen, setIsTeamModalOpen } = useWorkspace();
  const [isDesignSystemOpen, setIsDesignSystemOpen] = useState(false);
  const [isPostgresToolsOpen, setIsPostgresToolsOpen] = useState(false);
  const [isSqliteToolsOpen, setIsSqliteToolsOpen] = useState(false);
  const [isPinAuthOpen, setIsPinAuthOpen] = useState(false);
  const [isMonitorOpen, setIsMonitorOpen] = useState(false);
  const { settings, updateSetting, isLoading: isSettingsLoading } = useSettings();
  useResultTypeColors();
  const [isDebugMode, setIsDebugMode] = useState(false);
  const deepLinkInstall = useDeepLinkInstall();
  const [isCommunityModalDismissed, setIsCommunityModalDismissed] = useState(false);

  const lastSeenVersion = localStorage.getItem(WHATS_NEW_VERSION_KEY);
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(
    () => lastSeenVersion !== null && isVersionNewer(APP_VERSION, lastSeenVersion),
  );

  const { entries: allEntries, isLoading: isChangelogLoading } = useChangelog();

  const whatsNewEntries = useMemo(() => {
    if (!lastSeenVersion) return [];
    return allEntries.filter(
      (entry) =>
        isVersionNewer(entry.version, lastSeenVersion) &&
        isVersionAtMost(entry.version, APP_VERSION),
    );
  }, [lastSeenVersion, allEntries]);

  const dismissCommunityModal = useCallback(() => {
    updateSetting("showWelcome", false);
    localStorage.setItem(WHATS_NEW_VERSION_KEY, APP_VERSION);
    setIsCommunityModalDismissed(true);
  }, [updateSetting]);

  const dismissWhatsNew = useCallback(() => {
    localStorage.setItem(WHATS_NEW_VERSION_KEY, APP_VERSION);
    setIsWhatsNewOpen(false);
  }, []);

  // Seed WHATS_NEW_VERSION_KEY for users who completed the welcome flow
  // before the WhatsNew feature was introduced. Without this, lastSeenVersion
  // stays null and WhatsNew never triggers.
  useEffect(() => {
    if (
      !isSettingsLoading &&
      settings.showWelcome === false &&
      !localStorage.getItem(WHATS_NEW_VERSION_KEY)
    ) {
      localStorage.setItem(WHATS_NEW_VERSION_KEY, APP_VERSION);
    }
  }, [isSettingsLoading, settings.showWelcome]);

  useEffect(() => {
    invoke<boolean>("is_debug_mode").then((debugMode) => {
      setIsDebugMode(debugMode);
    });
  }, []);

  useEffect(() => {
    if (isDebugMode) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [isDebugMode]);

  useEffect(() => {
    const handleOpenDesignSystem = () => {
      setIsDesignSystemOpen(true);
    };

    window.addEventListener("open-design-system", handleOpenDesignSystem);
    return () => {
      window.removeEventListener("open-design-system", handleOpenDesignSystem);
    };
  }, []);

  useEffect(() => {
    const handleOpenPostgresTools = () => {
      setIsPostgresToolsOpen(true);
    };

    window.addEventListener("open-postgres-tools", handleOpenPostgresTools);
    window.addEventListener("app:open-postgres-tools", handleOpenPostgresTools);
    return () => {
      window.removeEventListener("open-postgres-tools", handleOpenPostgresTools);
      window.removeEventListener("app:open-postgres-tools", handleOpenPostgresTools);
    };
  }, []);

  useEffect(() => {
    const handleOpenSqliteTools = () => {
      setIsSqliteToolsOpen(true);
    };

    window.addEventListener("open-sqlite-tools", handleOpenSqliteTools);
    window.addEventListener("app:open-sqlite-tools", handleOpenSqliteTools);
    return () => {
      window.removeEventListener("open-sqlite-tools", handleOpenSqliteTools);
      window.removeEventListener("app:open-sqlite-tools", handleOpenSqliteTools);
    };
  }, []);

  useEffect(() => {
    const handleOpenPinAuth = () => {
      setIsPinAuthOpen(true);
    };

    window.addEventListener("open-pin-auth", handleOpenPinAuth);
    window.addEventListener("app:open-pin-auth", handleOpenPinAuth);
    return () => {
      window.removeEventListener("open-pin-auth", handleOpenPinAuth);
      window.removeEventListener("app:open-pin-auth", handleOpenPinAuth);
    };
  }, []);

  useEffect(() => {
    const handleOpenMonitor = () => {
      setIsMonitorOpen(true);
    };

    window.addEventListener("open-monitor", handleOpenMonitor);
    window.addEventListener("app:open-monitor", handleOpenMonitor);
    return () => {
      window.removeEventListener("open-monitor", handleOpenMonitor);
      window.removeEventListener("app:open-monitor", handleOpenMonitor);
    };
  }, []);

  return (
    <>
      <AlertProvider>
        <BrowserRouter>
          <ConnectionHealthMonitor />
          <KeybindingsProvider>
            <PluginSlotProvider>
              <PluginModalProvider>
                <ConnectionLayoutProvider>
                  <RightSidebarProvider>
                  <Routes>
                    <Route path="/" element={<MainLayout />}>
                      <Route
                        index
                        element={<Navigate to="/connections" replace />}
                      />
                      <Route path="connections" element={<Connections />} />
                      <Route
                        path="editor"
                        element={
                          <EditorErrorBoundary>
                            <Editor />
                          </EditorErrorBoundary>
                        }
                      />
                      <Route path="mcp" element={<McpPage />} />
                      <Route path="monitor" element={<MonitorPage />} />
                      <Route path="settings" element={<Settings />} />
                    </Route>
                    <Route
                      path="/schema-diagram"
                      element={<SchemaDiagramPage />}
                    />
                    <Route path="/task-manager" element={<TaskManagerPage />} />
                    <Route path="/visual-explain" element={<VisualExplainPage />} />
                    <Route path="/json-viewer" element={<JsonViewerPage />} />
                    <Route
                      path="/results-window"
                      element={<ResultsWindowPage />}
                    />
                  </Routes>
                  </RightSidebarProvider>
                </ConnectionLayoutProvider>
              </PluginModalProvider>
            </PluginSlotProvider>
          </KeybindingsProvider>
        </BrowserRouter>
      </AlertProvider>

      <UpdateNotificationModal
        isOpen={!!updateInfo}
        onClose={dismissUpdate}
        updateInfo={updateInfo!}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onDownloadAndInstall={downloadAndInstall}
        error={updateError}
      />

      <CommunityModal
        isOpen={!isSettingsLoading && settings.showWelcome !== false && !isCommunityModalDismissed}
        onClose={dismissCommunityModal}
      />

      <WhatsNewModal
        isOpen={isWhatsNewOpen && !isSettingsLoading && (settings.showWelcome === false || isCommunityModalDismissed)}
        onClose={dismissWhatsNew}
        entries={whatsNewEntries}
        isLoading={isChangelogLoading}
      />

      <AiApprovalGate />
      <SshAskpassGate />

      <PluginInstallConfirmModal
        key={
          deepLinkInstall.pending
            ? `${deepLinkInstall.pending.slug}@${deepLinkInstall.pending.version ?? ""}@${deepLinkInstall.pending.registry ?? ""}`
            : "idle"
        }
        request={deepLinkInstall.pending}
        busy={deepLinkInstall.busy}
        error={deepLinkInstall.error}
        onConfirm={() => {
          void deepLinkInstall.confirm();
        }}
        onCancel={deepLinkInstall.cancel}
        configuredRegistry={settings.tabulariumRegistryUrl ?? null}
      />

      <TeamMembersModal
        isOpen={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
      />

      <DesignSystemModal
        isOpen={isDesignSystemOpen}
        onClose={() => setIsDesignSystemOpen(false)}
      />

      <PostgresToolsModal
        isOpen={isPostgresToolsOpen}
        onClose={() => setIsPostgresToolsOpen(false)}
      />

      <SqliteToolsModal
        isOpen={isSqliteToolsOpen}
        onClose={() => setIsSqliteToolsOpen(false)}
      />

      <PinAuthModal
        isOpen={isPinAuthOpen}
        onClose={() => setIsPinAuthOpen(false)}
      />

      <DatabaseMonitorModal
        isOpen={isMonitorOpen}
        onClose={() => setIsMonitorOpen(false)}
      />

    </>
  );
}
