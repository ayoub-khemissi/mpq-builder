#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import * as path from "path";
import * as fs from "fs";
import { MpqManager } from "./mpq";

const program = new Command();

program
  .name("mpq-builder")
  .description("MPQ archive manager for WoW 3.3.5a patches")
  .version("1.0.0");

// ─── list ────────────────────────────────────────────────────────────────────

program
  .command("list")
  .alias("ls")
  .description("List files in an MPQ archive")
  .argument("<archive>", "Path to the MPQ archive")
  .option("-l, --long", "Show detailed information (file sizes)")
  .action((archive: string, opts: { long?: boolean }) => {
    const mpq = new MpqManager();
    try {
      mpq.open(archive, true);
      const files = mpq.listFiles();

      if (files.length === 0) {
        console.log(chalk.yellow("Archive is empty."));
        return;
      }

      console.log(chalk.bold(`\n  ${files.length} files in ${path.basename(archive)}\n`));

      if (opts.long) {
        const maxNameLen = Math.max(...files.map((f) => f.name.length));
        for (const file of files) {
          const size = formatSize(file.size);
          console.log(`  ${file.name.padEnd(maxNameLen + 2)}${chalk.dim(size)}`);
        }
      } else {
        for (const file of files) {
          console.log(`  ${file.name}`);
        }
      }
      console.log();
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      mpq.close();
    }
  });

// ─── info ────────────────────────────────────────────────────────────────────

program
  .command("info")
  .description("Show archive information")
  .argument("<archive>", "Path to the MPQ archive")
  .action((archive: string) => {
    const mpq = new MpqManager();
    try {
      mpq.open(archive, true);
      const info = mpq.getInfo();
      const stat = fs.statSync(archive);

      console.log(chalk.bold("\n  Archive Information\n"));
      console.log(`  Path:           ${info.path}`);
      console.log(`  Archive size:   ${formatSize(stat.size)}`);
      console.log(`  File count:     ${info.fileCount}`);
      console.log(`  Max file count: ${info.maxFileCount}`);
      console.log();
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      mpq.close();
    }
  });

// ─── extract ─────────────────────────────────────────────────────────────────

program
  .command("extract")
  .alias("x")
  .description("Extract files from an MPQ archive")
  .argument("<archive>", "Path to the MPQ archive")
  .argument("[file]", "Specific file to extract (extracts all if omitted)")
  .option("-o, --output <dir>", "Output directory", ".")
  .action((archive: string, file: string | undefined, opts: { output: string }) => {
    const mpq = new MpqManager();
    try {
      mpq.open(archive, true);

      if (file) {
        if (!mpq.hasFile(file)) {
          console.error(chalk.red(`File not found in archive: ${file}`));
          process.exit(1);
        }
        const outputPath = path.join(opts.output, file);
        mpq.extractFile(file, outputPath);
        console.log(chalk.green(`  Extracted: ${file} -> ${outputPath}`));
      } else {
        console.log(chalk.bold(`\n  Extracting all files to ${path.resolve(opts.output)}\n`));
        const extracted = mpq.extractAll(opts.output);
        console.log(chalk.green(`\n  Extracted ${extracted.length} files.\n`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      mpq.close();
    }
  });

// ─── create ──────────────────────────────────────────────────────────────────

program
  .command("create")
  .alias("c")
  .description("Create a new MPQ archive from files/directories")
  .argument("<archive>", "Path for the new MPQ archive")
  .argument("<sources...>", "Files or directories to add")
  .option("-n, --max-files <count>", "Maximum file count", "4096")
  .option("-p, --prefix <prefix>", "Archive path prefix for added files", "")
  .action((archive: string, sources: string[], opts: { maxFiles: string; prefix: string }) => {
    const mpq = new MpqManager();
    try {
      mpq.create(archive, { maxFileCount: parseInt(opts.maxFiles, 10) });
      let totalAdded = 0;

      console.log(chalk.bold(`\n  Creating ${path.basename(archive)}\n`));

      for (const source of sources) {
        const resolved = path.resolve(source);
        const stat = fs.statSync(resolved);

        if (stat.isDirectory()) {
          const added = mpq.addDirectory(resolved, opts.prefix);
          for (const f of added) {
            console.log(`  + ${f}`);
          }
          totalAdded += added.length;
        } else {
          const archPath = opts.prefix
            ? `${opts.prefix}\\${path.basename(resolved)}`
            : path.basename(resolved);
          mpq.addFile(resolved, { archivePath: archPath });
          console.log(`  + ${archPath}`);
          totalAdded++;
        }
      }

      mpq.compact();
      console.log(chalk.green(`\n  Created ${path.basename(archive)} with ${totalAdded} files.\n`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      mpq.close();
    }
  });

// ─── add ─────────────────────────────────────────────────────────────────────

program
  .command("add")
  .alias("a")
  .description("Add file(s) or a directory to an existing MPQ archive")
  .argument("<archive>", "Path to the MPQ archive")
  .argument("<sources...>", "Files or directories to add")
  .option("-p, --prefix <prefix>", "Archive path prefix", "")
  .option("-r, --replace", "Replace existing files", false)
  .action((archive: string, sources: string[], opts: { prefix: string; replace: boolean }) => {
    const mpq = new MpqManager();
    try {
      mpq.open(archive);
      let totalAdded = 0;

      console.log(chalk.bold(`\n  Adding to ${path.basename(archive)}\n`));

      for (const source of sources) {
        const resolved = path.resolve(source);
        const stat = fs.statSync(resolved);

        if (stat.isDirectory()) {
          const added = mpq.addDirectory(resolved, opts.prefix);
          for (const f of added) {
            console.log(`  + ${f}`);
          }
          totalAdded += added.length;
        } else {
          const archPath = opts.prefix
            ? `${opts.prefix}\\${path.basename(resolved)}`
            : path.basename(resolved);
          mpq.addFile(resolved, { archivePath: archPath, replace: opts.replace });
          console.log(`  + ${archPath}`);
          totalAdded++;
        }
      }

      mpq.compact();
      console.log(chalk.green(`\n  Added ${totalAdded} files.\n`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      mpq.close();
    }
  });

// ─── remove ──────────────────────────────────────────────────────────────────

program
  .command("remove")
  .alias("rm")
  .description("Remove a file from an MPQ archive")
  .argument("<archive>", "Path to the MPQ archive")
  .argument("<file>", "File path inside the archive")
  .action((archive: string, file: string) => {
    const mpq = new MpqManager();
    try {
      mpq.open(archive);

      if (!mpq.hasFile(file)) {
        console.error(chalk.red(`File not found in archive: ${file}`));
        process.exit(1);
      }

      mpq.removeFile(file);
      mpq.compact();
      console.log(chalk.green(`  Removed: ${file}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      mpq.close();
    }
  });

// ─── rename ──────────────────────────────────────────────────────────────────

program
  .command("rename")
  .alias("mv")
  .description("Rename a file inside an MPQ archive")
  .argument("<archive>", "Path to the MPQ archive")
  .argument("<old-path>", "Current file path inside the archive")
  .argument("<new-path>", "New file path inside the archive")
  .action((archive: string, oldPath: string, newPath: string) => {
    const mpq = new MpqManager();
    try {
      mpq.open(archive);
      mpq.renameFile(oldPath, newPath);
      console.log(chalk.green(`  Renamed: ${oldPath} -> ${newPath}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      mpq.close();
    }
  });

// ─── patch ───────────────────────────────────────────────────────────────────

program
  .command("patch")
  .description("Create a WoW 3.3.5a patch MPQ from a directory")
  .argument("<directory>", "Directory containing patch files (e.g. DBFilesClient/, Interface/)")
  .option("-o, --output <file>", "Output MPQ filename", "patch-custom.MPQ")
  .option("-n, --max-files <count>", "Maximum file count", "4096")
  .action((directory: string, opts: { output: string; maxFiles: string }) => {
    const mpq = new MpqManager();
    try {
      const resolved = path.resolve(directory);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        console.error(chalk.red(`Directory not found: ${resolved}`));
        process.exit(1);
      }

      console.log(chalk.bold(`\n  Creating WoW patch: ${opts.output}\n`));
      console.log(chalk.dim(`  Source: ${resolved}\n`));

      mpq.create(opts.output, { maxFileCount: parseInt(opts.maxFiles, 10) });
      const added = mpq.addDirectory(resolved);

      for (const f of added) {
        console.log(`  + ${f}`);
      }

      mpq.compact();

      const stat = fs.statSync(path.resolve(opts.output));
      console.log(
        chalk.green(
          `\n  Patch created: ${opts.output} (${formatSize(stat.size)}, ${added.length} files)\n`,
        ),
      );
      console.log(
        chalk.dim(
          `  Copy to: <WoW>/Data/ and name it patch-<X>.MPQ (where X > existing patches)\n`,
        ),
      );
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      mpq.close();
    }
  });

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
  return `${size} ${units[i]}`;
}

program.parse();
