// jsdom has no IndexedDB; the app keeps its offline copy there.
import "fake-indexeddb/auto";

// A full sync with planning can pass a second on a slow CI runner.
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 5000 });

// What was typed in Ajustes outlives its sheet: one test's drafts must not reach the next.
import { afterEach } from "vitest";
import { clearDrafts } from "./drafts.js";

afterEach(clearDrafts);
