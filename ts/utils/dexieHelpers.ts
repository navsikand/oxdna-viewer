import Dexie from "https://cdn.skypack.dev/dexie";


// Class-based approach to ensure type definitions persist in compiled output
class ShareInfo {
  shareUrl: string;
  shareId: string;
  createdAt: Date;
  expiresAt: Date | null;

  constructor(
    shareUrl: string,
    shareId: string,
    createdAt: Date,
    expiresAt: Date | null
  ) {
    this.shareUrl = shareUrl;
    this.shareId = shareId;
    this.createdAt = createdAt;
    this.expiresAt = expiresAt;
  }
}

class CommitType {
  data: ArrayBuffer;
  commitName: string;
  commitId: string;
  parent: string | null;
  createdAt?: number | Date;
  shareInfo?: ShareInfo;
  branchName?: string | null;
  // NEW: Encryption metadata
  isEncrypted?: boolean;
  encryptedData?: ArrayBuffer;
  iv?: ArrayBuffer;

  constructor(
    data: ArrayBuffer,
    commitName: string,
    commitId: string,
    parent: string | null,
    shareInfo?: ShareInfo,
    createdAt?: number | Date,
    branchName?: string | null,
    isEncrypted?: boolean,
    encryptedData?: ArrayBuffer,
    iv?: ArrayBuffer
  ) {
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
  id: string;
  commits: CommitType[]; // Renamed from 'structure' to 'commits'
  structureName: string;
  date: number;
  branches: { [key: string]: string[] };
  defaultBranchName?: string;
  currentBranchName?: string;
  currentCommitId?: string | null;
  isSynced: boolean; // NEW: Indicates if project is synced to backend
  syncedProjectId: string | null; // NEW: References SyncedOxviewProject.id
  isRemote?: boolean; // NEW: Indicates if structure should be deleted on logout
  // A cloned public project source id, if this was pulled from a public project
  publicSourceId?: string;
  // Whether this local copy is marked as public (synced with backend)
  isPublic?: boolean;
  // NEW: Encryption metadata for the entire project
  isEncrypted?: boolean;
  encryptedAt?: number;
  encryptionVersion?: string;

  constructor(
    id: string,
    commits: CommitType[],
    structureName: string,
    date: number,
    branches: { [key: string]: string[] },
    defaultBranchName: string | undefined,
    currentBranchName: string | undefined,
    currentCommitId: string | null | undefined,
    isSynced: boolean,
    syncedProjectId: string | null,
    isRemote?: boolean,
    publicSourceId?: string,
    isPublic?: boolean,
    isEncrypted?: boolean,
    encryptedAt?: number,
    encryptionVersion?: string
  ) {
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
  id: string;
  topFile: string;
  datFile: string;

  constructor(id: string, topFile: string, datFile: string) {
    this.id = id;
    this.topFile = topFile;
    this.datFile = datFile;
  }
}

function reconstructBranchesForLegacyProject(commits: CommitType[] | undefined): { [key: string]: string[] } {
  if (!commits || commits.length === 0) {
    return { main: [] };
  }

  const parentById = new Map<string, string | null>();
  const childIds = new Set<string>();
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

  const branches: { [key: string]: string[] } = {};
  leaves.forEach((leaf, index) => {
    const branchCommits: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = leaf.commitId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      branchCommits.unshift(cursor);
      cursor = parentById.get(cursor) || null;
    }
    branches[index === 0 ? "main" : `branch ${index + 1}`] = branchCommits;
  });

  return branches;
}

const DexieDB = new Dexie("Structures") as Dexie & {
  structureData: Dexie.Table<EntryType, string>;
  remoteStructureData: Dexie.Table<EntryType, string>;
  temporaryStructure: Dexie.Table<TemporaryStructure, string>;
};

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
      .modify((project: EntryType) => {
        if ((project as any).syncedProjectId === "") {
          project.syncedProjectId = null;
        }
        if ((project as any).publicSourceId === "") {
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

(window as any).DexieDB = DexieDB;

// Type for encrypted commit storage
interface EncryptedCommitType {
  encryptedData: ArrayBuffer;
  iv: ArrayBuffer;
  originalCommitId: string;
  originalCommitName: string;
  originalParent: string | null;
  originalCreatedAt?: number | Date;
}
