import Dexie from "https://cdn.skypack.dev/dexie";
// Class-based approach to ensure type definitions persist in compiled output
class ShareInfo {
    shareUrl;
    shareId;
    createdAt;
    expiresAt;
    constructor(shareUrl, shareId, createdAt, expiresAt) {
        this.shareUrl = shareUrl;
        this.shareId = shareId;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }
}
class CommitType {
    data;
    commitName;
    commitId;
    parent;
    createdAt;
    shareInfo;
    branchName;
    // NEW: Encryption metadata
    isEncrypted;
    encryptedData;
    iv;
    constructor(data, commitName, commitId, parent, shareInfo, createdAt, branchName, isEncrypted, encryptedData, iv) {
        this.data = data;
        this.commitName = commitName;
        this.commitId = commitId;
        this.parent = parent;
        this.shareInfo = shareInfo;
        this.createdAt = createdAt;
        this.branchName = branchName;
        this.isEncrypted = isEncrypted;
        this.encryptedData = encryptedData;
        this.iv = iv;
    }
}
class EntryType {
    id;
    commits; // Renamed from 'structure' to 'commits'
    structureName;
    date;
    branches;
    defaultBranchName;
    currentBranchName;
    currentCommitId;
    isSynced; // NEW: Indicates if project is synced to backend
    syncedProjectId; // NEW: References SyncedOxviewProject.id
    isRemote; // NEW: Indicates if structure should be deleted on logout
    // A cloned public project source id, if this was pulled from a public project
    publicSourceId;
    // Whether this local copy is marked as public (synced with backend)
    isPublic;
    // NEW: Encryption metadata for the entire project
    isEncrypted;
    encryptedAt;
    encryptionVersion;
    constructor(id, commits, structureName, date, branches, defaultBranchName, currentBranchName, currentCommitId, isSynced, syncedProjectId, isRemote, publicSourceId, isPublic, isEncrypted, encryptedAt, encryptionVersion) {
        this.id = id;
        this.commits = commits;
        this.structureName = structureName;
        this.date = date;
        this.branches = branches;
        this.defaultBranchName = defaultBranchName;
        this.currentBranchName = currentBranchName;
        this.currentCommitId = currentCommitId;
        this.isSynced = isSynced;
        this.syncedProjectId = syncedProjectId;
        this.isRemote = isRemote;
        this.publicSourceId = publicSourceId;
        this.isPublic = isPublic;
        this.isEncrypted = isEncrypted;
        this.encryptedAt = encryptedAt;
        this.encryptionVersion = encryptionVersion;
    }
}
class TemporaryStructure {
    id;
    topFile;
    datFile;
    constructor(id, topFile, datFile) {
        this.id = id;
        this.topFile = topFile;
        this.datFile = datFile;
    }
}
function reconstructBranchesForLegacyProject(commits) {
    if (!commits || commits.length === 0) {
        return { main: [] };
    }
    const parentById = new Map();
    const childIds = new Set();
    for (const commit of commits) {
        parentById.set(commit.commitId, commit.parent || null);
        if (commit.parent) {
            childIds.add(commit.parent);
        }
    }
    const leaves = commits.filter((commit) => !childIds.has(commit.commitId));
    if (leaves.length === 0) {
        return { main: commits.map((commit) => commit.commitId) };
    }
    const branches = {};
    leaves.forEach((leaf, index) => {
        const branchCommits = [];
        const seen = new Set();
        let cursor = leaf.commitId;
        while (cursor && !seen.has(cursor)) {
            seen.add(cursor);
            branchCommits.unshift(cursor);
            cursor = parentById.get(cursor) || null;
        }
        branches[index === 0 ? "main" : `branch ${index + 1}`] = branchCommits;
    });
    return branches;
}
const DexieDB = new Dexie("Structures");
// Version 1: Simplified schema with all current fields
DexieDB.version(1).stores({
    structureData: "id, structureName, isSynced, syncedProjectId, isRemote, publicSourceId, isPublic",
    remoteStructureData: "id, structureName, isSynced, syncedProjectId, isRemote, publicSourceId, isPublic",
    temporaryStructure: "id",
});
DexieDB.version(2)
    .stores({
    structureData: "id, structureName, isSynced, syncedProjectId, isRemote, publicSourceId, isPublic, currentBranchName, currentCommitId",
    remoteStructureData: "id, structureName, isSynced, syncedProjectId, isRemote, publicSourceId, isPublic, currentBranchName, currentCommitId",
    temporaryStructure: "id",
})
    .upgrade((tx) => {
    return tx
        .table("structureData")
        .toCollection()
        .modify((project) => {
        if (project.syncedProjectId === "") {
            project.syncedProjectId = null;
        }
        if (project.publicSourceId === "") {
            project.publicSourceId = undefined;
        }
        if (!project.branches || Object.keys(project.branches).length === 0) {
            project.branches = reconstructBranchesForLegacyProject(project.commits);
        }
        if (!project.defaultBranchName) {
            project.defaultBranchName = Object.keys(project.branches || {})[0] || "main";
        }
        if (!project.currentBranchName) {
            project.currentBranchName = project.defaultBranchName;
        }
        if (!project.currentCommitId && project.currentBranchName && project.branches?.[project.currentBranchName]?.length) {
            project.currentCommitId = project.branches[project.currentBranchName][project.branches[project.currentBranchName].length - 1] || null;
        }
    });
});
window.DexieDB = DexieDB;
