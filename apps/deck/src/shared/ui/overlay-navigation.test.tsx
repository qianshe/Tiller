import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { ScrollArea } from "./scroll-area";
import { Separator } from "./separator";
import { Skeleton } from "./skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

test("navigation primitives render stable classes", () => {
  const html = renderToString(
    createElement(
      "div",
      null,
      createElement(
        Tabs,
        { defaultValue: "one" },
        createElement(
          TabsList,
          { className: "custom-tabs" },
          createElement(TabsTrigger, { value: "one" }, "One"),
        ),
        createElement(TabsContent, { value: "one" }, "Panel"),
      ),
      createElement(ScrollArea, { className: "custom-scroll" }, "Scrollable"),
      createElement(Separator, { className: "custom-separator" }),
      createElement(Skeleton, { className: "custom-skeleton" }),
    ),
  );

  assert.match(html, /custom-tabs/);
  assert.match(html, /custom-scroll/);
  assert.match(html, /custom-separator/);
  assert.match(html, /custom-skeleton/);
});

test("overlay primitives expose accessible composition exports", () => {
  assert.equal(typeof Dialog, "function");
  assert.equal(typeof DialogContent, "object");
  assert.equal(typeof DropdownMenu, "function");
  assert.equal(typeof DropdownMenuTrigger, "object");
  assert.equal(typeof DropdownMenuItem, "object");
  assert.equal(typeof TooltipProvider, "function");
  assert.equal(typeof Tooltip, "function");
  assert.equal(typeof TooltipTrigger, "object");
  assert.equal(typeof TooltipContent, "object");

  assert.equal(typeof DialogTitle, "object");
  assert.equal(typeof DialogContent, "object");
});
