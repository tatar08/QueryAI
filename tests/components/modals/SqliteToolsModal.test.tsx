import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SqliteToolsModal } from "../../../src/components/modals/SqliteToolsModal";
import { invoke } from "@tauri-apps/api/core";

// Mock invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("SqliteToolsModal", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === "get_sqlite_pragmas") {
        return Promise.resolve({
          journalMode: "wal",
          synchronous: "NORMAL",
          foreignKeys: true,
          autoVacuum: "INCREMENTAL",
          cacheSize: -2000,
          pageSize: 4096,
          pageCount: 3840,
          freelistCount: 120,
          encoding: "UTF-8",
          userVersion: 4,
          walAutocheckpoint: 1000,
          databaseSizeBytes: 15728640,
          databaseSizePretty: "15.00 MB",
        });
      }
      if (cmd === "get_sqlite_attached_databases") {
        return Promise.resolve([
          { seq: 0, name: "main", file: "/data/production.sqlite" },
        ]);
      }
      if (cmd === "check_sqlite_integrity") {
        return Promise.resolve(["ok"]);
      }
      if (cmd === "execute_sqlite_maintenance") {
        return Promise.resolve("VACUUM completed successfully.");
      }
      if (cmd === "set_sqlite_pragma") {
        return Promise.resolve("PRAGMA setting set successfully.");
      }
      return Promise.resolve([]);
    });
  });

  it("renders when open and displays title, connection, and pragmas", async () => {
    render(
      <SqliteToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="sqlite-conn-1"
        connectionName="Production SQLite"
      />
    );

    expect(screen.getByText("SQLite Tools & Diagnostics")).toBeInTheDocument();
    expect(screen.getByText(/Production SQLite/)).toBeInTheDocument();
    expect(screen.getByText("PRAGMA Settings")).toBeInTheDocument();
    expect(screen.getByText("Integrity Check")).toBeInTheDocument();
    expect(screen.getByText("Maintenance & Backup")).toBeInTheDocument();
    expect(screen.getByText("Database Metrics")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Journal Mode")).toBeInTheDocument();
      expect(screen.getByText("Synchronous")).toBeInTheDocument();
      expect(screen.getByText("Foreign Keys")).toBeInTheDocument();
    });
  });

  it("switches to Integrity Check tab and executes quick check", async () => {
    render(
      <SqliteToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="sqlite-conn-1"
      />
    );

    const integrityTab = screen.getByRole("button", { name: /Integrity Check/ });
    fireEvent.click(integrityTab);

    const quickCheckBtn = screen.getByRole("button", { name: /Quick Check/ });
    fireEvent.click(quickCheckBtn);

    await waitFor(() => {
      expect(screen.getByText("Passed (No corruption detected)")).toBeInTheDocument();
      expect(screen.getByText("ok")).toBeInTheDocument();
    });
  });

  it("switches to Maintenance tab and triggers VACUUM", async () => {
    render(
      <SqliteToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="sqlite-conn-1"
      />
    );

    const maintTab = screen.getByRole("button", { name: /Maintenance & Backup/ });
    fireEvent.click(maintTab);

    const vacuumBtn = screen.getByRole("button", { name: /Run VACUUM/ });
    fireEvent.click(vacuumBtn);

    await waitFor(() => {
      expect(screen.getByText("VACUUM completed successfully.")).toBeInTheDocument();
    });
  });

  it("switches to Database Metrics tab and displays file metrics and attached DB", async () => {
    render(
      <SqliteToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="sqlite-conn-1"
      />
    );

    const metricsTab = screen.getByRole("button", { name: /Database Metrics/ });
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("15.00 MB")).toBeInTheDocument();
      expect(screen.getByText("4096 B")).toBeInTheDocument();
      expect(screen.getByText("/data/production.sqlite")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <SqliteToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="sqlite-conn-1"
      />
    );

    const closeBtn = screen.getByRole("button", { name: "Close modal" });
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalled();
  });
});
