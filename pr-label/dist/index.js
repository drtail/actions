"use strict";
/**
 * simple-labeler
 * Copyright (c) 2023-present NAVER Corp.
 * Apache-2.0
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const minimatch_1 = require("minimatch");
const run = async () => {
    try {
        const labels = core.getInput("labels").split("\n");
        const duplicatePatterns = core.getInput("duplicate-patterns").split("\n");
        const token = core.getInput("token");
        if (!token) {
            throw new Error("GitHub token is required");
        }
        if (!labels.length) {
            throw new Error("Labels are required");
        }
        if (!duplicatePatterns.length) {
            throw new Error("Duplicate patterns are required");
        }
        const octokit = github.getOctokit(token);
        const { owner, repo, number } = github.context.issue;
        const { data: pr } = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: number,
        });
        if (pr.draft) {
            core.info("This is a draft PR. No label added.");
            return;
        }
        const duplicate = duplicatePatterns.find((pattern) => pr.labels
            .map(({ name }) => name)
            .some((name) => (0, minimatch_1.minimatch)(name, pattern)));
        if (duplicate) {
            core.info(`PR #${number} already has a label matching the pattern "${duplicate}". No new labels added.`);
            return;
        }
        const { data: currentLabels } = await octokit.rest.issues.addLabels({
            owner,
            repo,
            issue_number: number,
            labels,
        });
        const currentLabelNames = currentLabels.map((label) => label.name);
        core.info(`Labels "${labels.join(", ")}" added to PR #${number}. Current labels on PR: "${currentLabelNames.join(", ")}"`);
    }
    catch (error) {
        core.setFailed(error.message);
    }
};
exports.run = run;
(0, exports.run)();
