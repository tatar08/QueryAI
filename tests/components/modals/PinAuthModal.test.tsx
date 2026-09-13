import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PinAuthModal } from "../../../src/components/modals/PinAuthModal";
import { invoke } from "@tauri-apps/api/core";

// Mock invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("PinAuthModal", () => {
  const mockOnClose = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string, args?: any) => {
      if (cmd === "pin_get_current_user") {
        return Promise.resolve({
          authenticated: false,
          token: null,
          user: null,
        });
      }
      if (cmd === "pin_login") {
        if (args?.pin === "948216" && args?.username === "testuser") {
          return Promise.resolve({
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfMTIzIiwidXNlcm5hbWUiOiJ0ZXN0dXNlciIsImlzcyI6InRhYnVsYXJpcyIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDI4ODAwfQ.test_sig",
            token_type: "Bearer",
            expires_at: 1700028800,
            user: {
              id: "usr_123",
              username: "testuser",
            },
          });
        }
        return Promise.reject(new Error("Invalid username or PIN"));
      }
      if (cmd === "pin_register") {
        return Promise.resolve({
          token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfcmVnIiwidXNlcm5hbWUiOiJuZXd1c2VyIiwiaXNzIjoidGFidWxhcmlzIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjE3MDAwMjg4MDB9.reg_sig",
          token_type: "Bearer",
          expires_at: 1700028800,
          user: {
            id: "usr_reg",
            username: args?.username,
            recovery_email: args?.recovery_email || null,
          },
        });
      }
      if (cmd === "pin_logout") {
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <PinAuthModal isOpen={false} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders modal header, mode tabs, username input, and dialpad when open", async () => {
    render(<PinAuthModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText(/Web PIN & JWT Auth/i)).toBeInTheDocument();
    expect(screen.getByText(/HS256/i)).toBeInTheDocument();
    expect(screen.getByTestId("tab-login")).toBeInTheDocument();
    expect(screen.getByTestId("tab-register")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/เช่น admin หรือ tar/i)).toBeInTheDocument();

    // Dialpad numbers 0-9
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "9" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  it("enters digits using dialpad buttons and backspace", async () => {
    render(<PinAuthModal isOpen={true} onClose={mockOnClose} />);

    // Initially 0/8
    expect(screen.getByText("0/8 หลัก")).toBeInTheDocument();

    // Press '9', '4', '8'
    fireEvent.click(screen.getByRole("button", { name: "9" }));
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "8" }));

    expect(screen.getByText("3/8 หลัก")).toBeInTheDocument();

    // Click backspace
    const backspaceBtn = screen.getByTitle("Backspace");
    fireEvent.click(backspaceBtn);

    expect(screen.getByText("2/8 หลัก")).toBeInTheDocument();

    // Click clear
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByText("0/8 หลัก")).toBeInTheDocument();
  });

  it("successfully logs in with valid username and PIN, displaying JWT Bearer card", async () => {
    render(
      <PinAuthModal
        isOpen={true}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
      />
    );

    // Enter username
    const usernameInput = screen.getByPlaceholderText(/เช่น admin หรือ tar/i);
    fireEvent.change(usernameInput, { target: { value: "testuser" } });

    // Enter PIN: 948216 (6 digits)
    const digits = ["9", "4", "8", "2", "1", "6"];
    for (const d of digits) {
      fireEvent.click(screen.getByRole("button", { name: d }));
    }

    expect(screen.getByText("6/8 หลัก")).toBeInTheDocument();

    // Click Sign In
    const submitBtn = screen.getByTestId("pin-submit-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pin_login", {
        username: "testuser",
        pin: "948216",
      });
    });

    // Verify JWT inspect panel is shown
    await waitFor(() => {
      expect(screen.getByText(/ยินดีต้อนรับ, testuser!/i)).toBeInTheDocument();
      expect(screen.getByText(/Authorization Bearer JWT/i)).toBeInTheDocument();
      expect(screen.getByTestId("copy-token-btn")).toBeInTheDocument();
    });

    expect(mockOnSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ username: "testuser" }),
      expect.stringContaining("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")
    );
  });

  it("handles registration flow with PIN validation and confirmation", async () => {
    render(<PinAuthModal isOpen={true} onClose={mockOnClose} />);

    // Switch to register tab
    fireEvent.click(screen.getByTestId("tab-register"));

    // Recovery email input appears
    expect(screen.getByPlaceholderText("user@example.com")).toBeInTheDocument();

    const usernameInput = screen.getByPlaceholderText(/เช่น admin หรือ tar/i);
    fireEvent.change(usernameInput, { target: { value: "newuser" } });

    // Try sequential PIN: 123456 -> should show validation error
    const seqDigits = ["1", "2", "3", "4", "5", "6"];
    for (const d of seqDigits) {
      fireEvent.click(screen.getByRole("button", { name: d }));
    }

    expect(screen.getByText(/PIN is too simple/i)).toBeInTheDocument();

    // Clear and enter good PIN: 948216
    fireEvent.click(screen.getByTestId("pin-clear-btn"));
    const validDigits = ["9", "4", "8", "2", "1", "6"];
    for (const d of validDigits) {
      fireEvent.click(screen.getByRole("button", { name: d }));
    }

    expect(screen.getByText(/PIN มีความปลอดภัย/i)).toBeInTheDocument();

    // Click Next: Confirm PIN
    const nextBtn = screen.getByTestId("pin-submit-btn");
    fireEvent.click(nextBtn);

    // Prompt changes to confirm
    expect(screen.getByText(/กรุณากดรหัส PIN ตัวเดิมซ้ำอีกครั้ง/i)).toBeInTheDocument();

    // Enter matching confirm PIN
    for (const d of validDigits) {
      fireEvent.click(screen.getByRole("button", { name: d }));
    }

    // Submit confirmation
    const confirmBtn = screen.getByTestId("pin-submit-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pin_register", {
        username: "newuser",
        pin: "948216",
        recovery_email: undefined,
      });
    });

    // Authenticated view displayed
    await waitFor(() => {
      expect(screen.getByText(/ยินดีต้อนรับ, newuser!/i)).toBeInTheDocument();
    });
  });

  it("handles logout from authenticated view", async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
      if (cmd === "pin_get_current_user") {
        return Promise.resolve({
          authenticated: true,
          token: "mock_jwt_token",
          user: { id: "usr_1", username: "logged_in_user" },
        });
      }
      if (cmd === "pin_logout") {
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });

    render(<PinAuthModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText(/ยินดีต้อนรับ, logged_in_user!/i)).toBeInTheDocument();
    });

    const logoutBtn = screen.getByTestId("pin-logout-btn");
    fireEvent.click(logoutBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("pin_logout");
      expect(screen.getByText(/ออกจากระบบเรียบร้อยแล้ว/i)).toBeInTheDocument();
    });
  });
});
