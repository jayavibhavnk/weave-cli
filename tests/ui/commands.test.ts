import { describe, it, expect } from "vitest";
import { findCommand, getCompletions, commands } from "../../src/ui/commands.js";

describe("commands", () => {
  describe("findCommand", () => {
    it("finds /help with no args", () => {
      const found = findCommand("/help");
      expect(found).not.toBeNull();
      expect(found!.cmd.name).toBe("/help");
      expect(found!.args).toBe("");
    });

    it("finds /recall with query as args", () => {
      const found = findCommand("/recall deadline");
      expect(found).not.toBeNull();
      expect(found!.cmd.name).toBe("/recall");
      expect(found!.args).toBe("deadline");
    });

    it("returns null for unknown command", () => {
      expect(findCommand("/unknown")).toBeNull();
      expect(findCommand("/")).toBeNull();
    });

    it("is case-insensitive for command name", () => {
      const found = findCommand("/HELP");
      expect(found).not.toBeNull();
      expect(found!.cmd.name).toBe("/help");
    });

    it("trims input", () => {
      const found = findCommand("  /help   ");
      expect(found).not.toBeNull();
    });
  });

  describe("getCompletions", () => {
    it("returns commands starting with prefix", () => {
      const c = getCompletions("/rec");
      expect(c.some((x) => x.name === "/recall")).toBe(true);
    });

    it("does not include hidden commands", () => {
      const all = getCompletions("/");
      const names = all.map((x) => x.name);
      expect(names).not.toContain("/quit");
    });

    it("hidden /quit exists in commands but is hidden", () => {
      const quit = commands.find((c) => c.name === "/quit");
      expect(quit).toBeDefined();
      expect(quit!.hidden).toBe(true);
    });
  });
});
