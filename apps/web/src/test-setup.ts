// jsdom has no IndexedDB; the app keeps its offline copy there.
import "fake-indexeddb/auto";

// A full sync with planning can pass a second on a slow CI runner.
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 5000 });
