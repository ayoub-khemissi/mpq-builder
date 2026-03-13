import {
  Archive,
  type FileInfo,
  MPQ_FILE_COMPRESS,
  MPQ_FILE_REPLACEEXISTING,
  MPQ_COMPRESSION_ZLIB,
  MPQ_CREATE_LISTFILE,
  MPQ_CREATE_ATTRIBUTES,
  MPQ_CREATE_ARCHIVE_V1,
  MPQ_OPEN_READ_ONLY,
} from "@jamiephan/stormlib";
import * as fs from "fs";
import * as path from "path";

export interface MpqFileInfo {
  name: string;
  size: number;
}

export interface MpqArchiveInfo {
  path: string;
  fileCount: number;
  maxFileCount: number;
  files: MpqFileInfo[];
}

export interface AddFileOptions {
  /** Path inside the archive (default: relative path from source) */
  archivePath?: string;
  /** Replace if file already exists */
  replace?: boolean;
  /** Use compression (default: true) */
  compress?: boolean;
}

export interface CreateOptions {
  /** Maximum number of files the archive can hold (default: 4096) */
  maxFileCount?: number;
  /** Include a listfile for file enumeration (default: true) */
  listfile?: boolean;
  /** Include attributes file (default: true) */
  attributes?: boolean;
}

export class MpqManager {
  private archive: Archive;
  private archivePath: string | null = null;
  private isOpen = false;
  private readOnly = false;

  constructor() {
    this.archive = new Archive();
  }

  /**
   * Open an existing MPQ archive.
   */
  open(filePath: string, readOnly = false): void {
    if (this.isOpen) this.close();

    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Archive not found: ${resolved}`);
    }

    this.archive.open(resolved, { flags: readOnly ? MPQ_OPEN_READ_ONLY : 0 });
    this.archivePath = resolved;
    this.isOpen = true;
    this.readOnly = readOnly;
  }

  /**
   * Create a new MPQ archive.
   */
  create(filePath: string, options: CreateOptions = {}): void {
    if (this.isOpen) this.close();

    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let flags = MPQ_CREATE_ARCHIVE_V1;
    if (options.listfile !== false) flags |= MPQ_CREATE_LISTFILE;
    if (options.attributes !== false) flags |= MPQ_CREATE_ATTRIBUTES;

    this.archive.create(resolved, {
      maxFileCount: options.maxFileCount ?? 4096,
      flags,
    });

    this.archivePath = resolved;
    this.isOpen = true;
    this.readOnly = false;
  }

  /**
   * List all files in the archive.
   */
  listFiles(): MpqFileInfo[] {
    this.ensureOpen();
    const files: FileInfo[] = this.archive.listFiles();
    return files.map((f) => ({
      name: f.name,
      size: f.fileSize,
    }));
  }

  /**
   * Get archive information.
   */
  getInfo(): MpqArchiveInfo {
    this.ensureOpen();
    const files = this.listFiles();
    return {
      path: this.archivePath!,
      fileCount: files.length,
      maxFileCount: this.archive.getMaxFileCount(),
      files,
    };
  }

  /**
   * Check if a file exists in the archive.
   */
  hasFile(archivePath: string): boolean {
    this.ensureOpen();
    return this.archive.hasFile(archivePath);
  }

  /**
   * Read a file from the archive and return its contents as a Buffer.
   */
  readFile(archivePath: string): Buffer {
    this.ensureOpen();
    const file = this.archive.openFile(archivePath);
    try {
      const content = file.readAll();
      return Buffer.from(content);
    } finally {
      file.close();
    }
  }

  /**
   * Extract a file from the archive to disk.
   */
  extractFile(archivePath: string, outputPath: string): void {
    this.ensureOpen();
    const resolved = path.resolve(outputPath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.archive.extractFile(archivePath, resolved);
  }

  /**
   * Extract all files from the archive to a directory.
   */
  extractAll(outputDir: string): string[] {
    this.ensureOpen();
    const resolved = path.resolve(outputDir);
    const files = this.listFiles();
    const extracted: string[] = [];

    for (const file of files) {
      // Skip internal files
      if (file.name === "(listfile)" || file.name === "(attributes)" || file.name === "(signature)") {
        continue;
      }

      const outputPath = path.join(resolved, file.name);
      try {
        this.extractFile(file.name, outputPath);
        extracted.push(file.name);
      } catch (err) {
        console.error(`  Failed to extract ${file.name}: ${(err as Error).message}`);
      }
    }

    return extracted;
  }

  /**
   * Add a file from disk to the archive.
   */
  addFile(localPath: string, options: AddFileOptions = {}): void {
    this.ensureOpen();
    this.ensureWritable();

    const resolved = path.resolve(localPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }

    const archPath = options.archivePath ?? path.basename(resolved);
    // Normalize to backslashes (MPQ convention)
    const mpqPath = archPath.replace(/\//g, "\\");

    let flags = 0;
    if (options.compress !== false) flags |= MPQ_FILE_COMPRESS;
    if (options.replace) flags |= MPQ_FILE_REPLACEEXISTING;

    this.archive.addFileEx(
      resolved,
      mpqPath,
      flags,
      MPQ_COMPRESSION_ZLIB,
      MPQ_COMPRESSION_ZLIB,
    );
  }

  /**
   * Add all files from a directory recursively to the archive.
   * The directory structure is preserved as the archive path prefix.
   */
  addDirectory(dirPath: string, archivePrefix = ""): string[] {
    this.ensureOpen();
    this.ensureWritable();

    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Directory not found: ${resolved}`);
    }

    const added: string[] = [];
    const walk = (dir: string, prefix: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const archPath = prefix ? `${prefix}\\${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walk(fullPath, archPath);
        } else if (entry.isFile()) {
          this.addFile(fullPath, {
            archivePath: archPath,
            replace: true,
            compress: true,
          });
          added.push(archPath);
        }
      }
    };

    walk(resolved, archivePrefix);
    return added;
  }

  /**
   * Remove a file from the archive.
   */
  removeFile(archivePath: string): void {
    this.ensureOpen();
    this.ensureWritable();
    this.archive.removeFile(archivePath);
  }

  /**
   * Rename a file inside the archive.
   */
  renameFile(oldPath: string, newPath: string): void {
    this.ensureOpen();
    this.ensureWritable();
    this.archive.renameFile(oldPath, newPath);
  }

  /**
   * Compact the archive (remove unused space after deletions).
   */
  compact(): void {
    this.ensureOpen();
    this.ensureWritable();
    this.archive.compact();
  }

  /**
   * Flush and close the archive.
   */
  close(): void {
    if (this.isOpen) {
      this.archive.close();
      this.isOpen = false;
      this.archivePath = null;
    }
  }

  /**
   * Get the current archive path.
   */
  getPath(): string | null {
    return this.archivePath;
  }

  private ensureOpen(): void {
    if (!this.isOpen) {
      throw new Error("No archive is currently open. Call open() or create() first.");
    }
  }

  private ensureWritable(): void {
    if (this.readOnly) {
      throw new Error("Archive is opened in read-only mode.");
    }
  }
}
