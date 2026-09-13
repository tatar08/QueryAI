import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Button } from "../../../src/components/ui/Button";
import { Badge } from "../../../src/components/ui/Badge";
import { Card, CardHeader, CardBody, CardFooter } from "../../../src/components/ui/Card";
import { DesignSystemModal } from "../../../src/components/modals/DesignSystemModal";

describe("Design System Component Primitives", () => {
  it("renders Button with default variant and responds to click", () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click Me</Button>);

    const btn = screen.getByRole("button", { name: "Click Me" });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("disables Button when loading is true", () => {
    render(<Button loading>Submit</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
  });

  it("renders Badge with variant and dot indicator", () => {
    const { container } = render(
      <Badge variant="success" dot>
        Active
      </Badge>
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
    const dot = container.querySelector(".bg-emerald-400");
    expect(dot).toBeInTheDocument();
  });

  it("renders Card with header, body and footer", () => {
    render(
      <Card>
        <CardHeader title="Card Title" subtitle="Card Subtitle" />
        <CardBody>Card Content</CardBody>
        <CardFooter>Card Footer</CardFooter>
      </Card>
    );

    expect(screen.getByText("Card Title")).toBeInTheDocument();
    expect(screen.getByText("Card Subtitle")).toBeInTheDocument();
    expect(screen.getByText("Card Content")).toBeInTheDocument();
    expect(screen.getByText("Card Footer")).toBeInTheDocument();
  });

  it("renders DesignSystemModal with tabs when isOpen is true", () => {
    const handleClose = vi.fn();
    render(<DesignSystemModal isOpen={true} onClose={handleClose} />);

    expect(screen.getByText("Tabularis UI Design System")).toBeInTheDocument();
    expect(screen.getByText("Tokens & Palette")).toBeInTheDocument();
    expect(screen.getByText("Component Primitives")).toBeInTheDocument();
    expect(screen.getByText("Iconography & Assets")).toBeInTheDocument();
    expect(screen.getByText("Call for Contributors")).toBeInTheDocument();
  });
});
