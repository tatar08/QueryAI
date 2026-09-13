import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PostgresToolsModal } from "../../../src/components/modals/PostgresToolsModal";
import { invoke } from "@tauri-apps/api/core";

// Mock invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("PostgresToolsModal", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === "get_pg_activity") {
        return Promise.resolve([
          {
            pid: 1234,
            usename: "postgres",
            datname: "mydb",
            clientAddr: "127.0.0.1",
            state: "active",
            query: "SELECT * FROM users",
            waitEventType: "",
            waitEvent: "",
            durationSeconds: 1.5,
          },
        ]);
      }
      if (cmd === "get_pg_extensions") {
        return Promise.resolve([
          {
            name: "uuid-ossp",
            defaultVersion: "1.1",
            installedVersion: "1.1",
            comment: "generate uuid values",
          },
        ]);
      }
      if (cmd === "get_pg_database_metrics") {
        return Promise.resolve({
          databaseSize: "45 MB",
          activeConnections: 5,
          idleConnections: 2,
          totalConnections: 7,
          cacheHitRatio: 99.4,
        });
      }
      if (cmd === "execute_pg_maintenance") {
        return Promise.resolve("VACUUM completed successfully");
      }
      return Promise.resolve([]);
    });
  });

  it("renders when open and displays connection name and activity tab", async () => {
    render(
      <PostgresToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="test-conn-1"
        connectionName="Production PG"
      />
    );

    expect(screen.getByText("PostgreSQL Tools & Activity")).toBeInTheDocument();
    expect(screen.getByText(/Production PG/)).toBeInTheDocument();
    expect(screen.getByText(/Live Activity/)).toBeInTheDocument();
    expect(screen.getByText("Extensions")).toBeInTheDocument();
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
    expect(screen.getByText("Database Metrics")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("SELECT * FROM users")).toBeInTheDocument();
      expect(screen.getByText("1234")).toBeInTheDocument();
    });
  });

  it("switches tabs and displays extensions", async () => {
    render(
      <PostgresToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="test-conn-1"
      />
    );

    const extTab = screen.getByRole("button", { name: /Extensions/ });
    fireEvent.click(extTab);

    await waitFor(() => {
      expect(screen.getByText("uuid-ossp")).toBeInTheDocument();
      expect(screen.getByText("generate uuid values")).toBeInTheDocument();
    });
  });

  it("switches to metrics tab and displays database metrics", async () => {
    render(
      <PostgresToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="test-conn-1"
      />
    );

    const metricsTab = screen.getByRole("button", { name: /Database Metrics/ });
    fireEvent.click(metricsTab);

    await waitFor(() => {
      expect(screen.getByText("45 MB")).toBeInTheDocument();
      expect(screen.getByText("99.4%")).toBeInTheDocument();
    });
  });

  it("calls onClose when close button is clicked", () => {
    render(
      <PostgresToolsModal
        isOpen={true}
        onClose={mockOnClose}
        connectionId="test-conn-1"
      />
    );

    const closeBtn = screen.getByRole("button", { name: "Close modal" });
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalled();
  });
});
