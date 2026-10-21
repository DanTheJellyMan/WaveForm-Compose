/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
    build: {
        emptyOutDir: true,
        lib: {
            name: "WaveForm-Compose",
            entry: "src",
            formats: ["es"]
        }
    },
    test: {
        silent: "passed-only",
        server: {
            deps: { inline: ["wgsl_reflect"],"fallbackCJS":true }
        },
        projects: [
            {
                test: {
                    name: "general-testing",
                    include: [".\/tests\/**\/*.test.ts"],
                    exclude: [".\/tests\/render-engine\/**\/*.test.ts"],
                    browser: { enabled: false }
                }
            },
            {
                test: {
                    name: "render-engine-testing",
                    include: [".\/tests\/render-engine\/**\/*.test.ts"],
                    browser: {
                        enabled: true,
                        provider: playwright({
                            launchOptions: {
                                channel: "chromium",
                                // args: ["--enable-unsafe-webgpu"]
                            }
                        }),
                        headless: true,
                        screenshotFailures: false,
                        instances: [
                            { browser: "chromium" }
                        ]
                    }
                }
            }
        ],

        pool: "vmThreads",
        vmMemoryLimit: "10MB"
    }
});