import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Label } from "./label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Switch } from "./switch";
import { Textarea } from "./textarea";

test("form text primitives render passed className", () => {
  const html = renderToString(
    createElement(
      "div",
      null,
      createElement(Label, { className: "custom-label" }, "Name"),
      createElement(Input, { className: "custom-input", defaultValue: "deck" }),
      createElement(Textarea, { className: "custom-textarea", defaultValue: "notes" }),
    ),
  );

  assert.match(html, /custom-label/);
  assert.match(html, /custom-input/);
  assert.match(html, /custom-textarea/);
  assert.match(html, /bg-surface/);
});

test("Select exposes trigger content and item exports", () => {
  assert.equal(typeof Select, "function");
  assert.equal(typeof SelectTrigger, "object");
  assert.equal(typeof SelectContent, "object");
  assert.equal(typeof SelectItem, "object");

  const html = renderToString(
    createElement(
      Select,
      { defaultValue: "deck" },
      createElement(
        SelectTrigger,
        { className: "custom-select" },
        createElement(SelectValue, { placeholder: "Choose" }),
      ),
    ),
  );

  assert.match(html, /custom-select/);
});

test("Switch and Checkbox accept controlled props", () => {
  const html = renderToString(
    createElement(
      "div",
      null,
      createElement(Switch, {
        checked: true,
        onCheckedChange: () => undefined,
        className: "custom-switch",
      }),
      createElement(Checkbox, {
        checked: true,
        onCheckedChange: () => undefined,
        className: "custom-checkbox",
      }),
    ),
  );

  assert.match(html, /custom-switch/);
  assert.match(html, /custom-checkbox/);
  assert.match(html, /data-state="checked"/);
});

test("form controls use Workbench typography tokens", () => {
  const html = renderToString(
    createElement(
      "div",
      null,
      createElement(Input, { defaultValue: "deck" }),
      createElement(
        Select,
        { defaultValue: "deck" },
        createElement(
          SelectTrigger,
          null,
          createElement(SelectValue, { placeholder: "Choose" }),
        ),
      ),
    ),
  );

  assert.match(html, /text-section/);
  assert.doesNotMatch(html, /text-\[13px\]/);
  assert.doesNotMatch(html, /text-sm/);
});
