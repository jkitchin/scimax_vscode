/**
 * Publish command - publish org projects to HTML
 *
 * Usage:
 *   scimax publish              # Publish all projects
 *   scimax publish <project>    # Publish specific project
 *   scimax publish --init       # Initialize publish configuration
 *   scimax publish --list       # List configured projects
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    loadConfig,
    publishProject,
    publishAll,
    publishProjectWithTheme,
    createProjectConfig,
    saveConfig,
    saveConfigYaml,
    PublishProjectResult,
    PublishOptions,
} from '../../publishing/orgPublish';
import {
    PublishConfig,
    PublishProject,
    isPublishProject,
    mergeWithDefaults,
} from '../../publishing/publishProject';

interface CliConfig {
    dbPath: string;
    rootDir: string;
}

interface ParsedArgs {
    command: string;
    subcommand?: string;
    args: string[];
    flags: Record<string, string | boolean>;
}

/**
 * Publish command handler
 */
export async function publishCommand(config: CliConfig, args: ParsedArgs): Promise<void> {
    const workspaceRoot = config.rootDir;

    // Handle --init flag
    if (args.flags.init) {
        await initPublishConfig(workspaceRoot, args);
        return;
    }

    // Load publish configuration
    const publishConfig = await loadConfig(workspaceRoot);

    if (!publishConfig) {
        console.error('No publishing configuration found.');
        console.error('');
        console.error('Create one with: scimax publish --init');
        console.error('');
        console.error('Or create .org-publish.json or _config.yml manually.');
        process.exit(1);
    }

    const json = args.flags.json === true;

    // Handle --list flag
    if (args.flags.list) {
        if (json) {
            const projectList = Object.entries(publishConfig.projects).map(([name, project]) => ({
                name,
                publishable: isPublishProject(project),
                ...(isPublishProject(project) ? {
                    source: (project as PublishProject).baseDirectory,
                    output: (project as PublishProject).publishingDirectory,
                    is_default: name === publishConfig.defaultProject,
                } : {
                    components: (project as any).components,
                }),
            }));
            console.log(JSON.stringify({ projects: projectList }, null, 2));
        } else {
            listProjects(publishConfig);
        }
        return;
    }

    // Build publish options
    const isTTY = process.stdout.isTTY && !json;
    const options: PublishOptions = {
        force: !!args.flags.force,
        dryRun: !!args.flags['dry-run'],
        onProgress: isTTY ? (current, total, file) => {
            const pct = Math.round((current / total) * 100);
            process.stdout.write(`\r[${pct}%] Publishing ${file}...`.padEnd(60));
        } : undefined,
    };

    // Get project name if specified
    const projectName = args.args[0];

    try {
        let results: PublishProjectResult[];

        if (projectName) {
            // Publish specific project
            const projectConfig = publishConfig.projects[projectName];

            if (!projectConfig) {
                if (json) {
                    console.log(JSON.stringify({ success: false, error: `Project '${projectName}' not found`, available: Object.keys(publishConfig.projects) }));
                } else {
                    console.error(`Project '${projectName}' not found.`);
                    console.error('');
                    console.error('Available projects:');
                    listProjects(publishConfig);
                }
                process.exit(1);
            }

            if (!isPublishProject(projectConfig)) {
                if (json) {
                    console.log(JSON.stringify({ success: false, error: `'${projectName}' is a component project, not publishable` }));
                } else {
                    console.error(`'${projectName}' is a component project, not a publishable project.`);
                }
                process.exit(1);
            }

            const project = mergeWithDefaults({ ...projectConfig, name: projectName });

            if (!json) {
                console.log(`Publishing project: ${projectName}`);
                console.log(`  Source: ${project.baseDirectory}`);
                console.log(`  Output: ${project.publishingDirectory}`);
                console.log('');
            }

            let result: PublishProjectResult;

            // Use theme-based publishing if configured
            if (publishConfig.theme && publishConfig.theme.name !== 'default') {
                result = await publishProjectWithTheme(
                    project, workspaceRoot, options, publishConfig.theme
                );
            } else {
                result = await publishProject(project, workspaceRoot, options);
            }

            results = [result];
        } else {
            // Publish all projects
            if (!json) {
                console.log('Publishing all projects...');
                console.log('');
            }

            results = await publishAll(publishConfig, workspaceRoot, options);
        }

        // Clear progress line (TTY only)
        if (isTTY) {
            process.stdout.write('\r'.padEnd(60) + '\r');
        }

        if (json) {
            const summary = results.map(r => ({
                project: r.projectName,
                success: r.errorCount === 0,
                files_published: r.successCount,
                files_total: r.totalFiles,
                errors: r.files.filter(f => !f.success).map(f => ({
                    file: f.sourcePath,
                    error: f.error,
                })),
                duration_ms: r.duration,
            }));
            console.log(JSON.stringify({
                dry_run: !!options.dryRun,
                projects: summary,
                total_files: results.reduce((s, r) => s + r.totalFiles, 0),
                total_published: results.reduce((s, r) => s + r.successCount, 0),
                total_errors: results.reduce((s, r) => s + r.errorCount, 0),
            }, null, 2));
        } else {
            printSummary(results, options.dryRun);
        }
    } catch (error) {
        if (json) {
            console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }));
        } else {
            console.error('');
            console.error('Publishing failed:', error instanceof Error ? error.message : error);
        }
        process.exit(1);
    }
}

/**
 * List configured projects
 */
function listProjects(config: PublishConfig): void {
    const projects = Object.entries(config.projects);

    if (projects.length === 0) {
        console.log('No projects configured.');
        return;
    }

    console.log('Configured projects:');
    console.log('');

    for (const [name, project] of projects) {
        if (isPublishProject(project)) {
            const p = project as PublishProject;
            console.log(`  ${name}`);
            console.log(`    Source: ${p.baseDirectory}`);
            console.log(`    Output: ${p.publishingDirectory}`);
            if (name === config.defaultProject) {
                console.log(`    (default)`);
            }
            console.log('');
        } else {
            console.log(`  ${name} (component)`);
            console.log(`    Components: ${project.components.join(', ')}`);
            console.log('');
        }
    }
}

/**
 * Print publishing summary
 */
function printSummary(results: PublishProjectResult[], dryRun?: boolean): void {
    const prefix = dryRun ? '[DRY RUN] ' : '';

    for (const result of results) {
        console.log(`${prefix}Project: ${result.projectName}`);
        console.log(`  Files: ${result.successCount}/${result.totalFiles} published`);

        if (result.errorCount > 0) {
            console.log(`  Errors: ${result.errorCount}`);

            // Show individual errors
            for (const file of result.files) {
                if (!file.success) {
                    const relativePath = path.relative(process.cwd(), file.sourcePath);
                    console.log(`    ✗ ${relativePath}: ${file.error}`);
                }
            }
        }

        console.log(`  Duration: ${result.duration}ms`);
        console.log('');
    }

    // Overall summary
    const totalFiles = results.reduce((sum, r) => sum + r.totalFiles, 0);
    const totalSuccess = results.reduce((sum, r) => sum + r.successCount, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    if (results.length > 1) {
        console.log('─'.repeat(40));
        console.log(`${prefix}Total: ${totalSuccess}/${totalFiles} files in ${totalDuration}ms`);

        if (totalErrors > 0) {
            console.log(`  ${totalErrors} error(s)`);
        }
    }

    if (totalErrors === 0) {
        console.log('');
        console.log(dryRun ? 'Dry run complete.' : 'Publishing complete!');
    }
}

/**
 * Initialize a new publish configuration
 */
async function initPublishConfig(workspaceRoot: string, args: ParsedArgs): Promise<void> {
    // Check if config already exists
    const jsonPath = path.join(workspaceRoot, '.org-publish.json');
    const yamlPath = path.join(workspaceRoot, '_config.yml');

    if (fs.existsSync(jsonPath) || fs.existsSync(yamlPath)) {
        if (!args.flags.force) {
            console.error('Publishing configuration already exists.');
            console.error('Use --force to overwrite.');
            process.exit(1);
        }
    }

    // Get options from flags or use defaults
    const name = typeof args.flags.name === 'string' ? args.flags.name : 'main';
    const baseDir = typeof args.flags.base === 'string' ? args.flags.base : './';
    const outputDir = typeof args.flags.output === 'string' ? args.flags.output : './_build/html';
    const useGitHub = args.flags.github !== false;
    const useSitemap = args.flags.sitemap !== false;
    const useYaml = !!args.flags.yaml;

    // Create configuration
    const config = createProjectConfig(name, baseDir, outputDir, useGitHub, useSitemap);

    // Save configuration
    if (useYaml) {
        await saveConfigYaml(workspaceRoot, config);
        console.log(`Created _config.yml`);
    } else {
        await saveConfig(workspaceRoot, config);
        console.log(`Created .org-publish.json`);
    }

    console.log('');
    console.log('Publishing configuration initialized:');
    console.log(`  Project: ${name}`);
    console.log(`  Source: ${baseDir}`);
    console.log(`  Output: ${outputDir}`);
    console.log(`  GitHub Pages: ${useGitHub ? 'yes' : 'no'}`);
    console.log(`  Auto Sitemap: ${useSitemap ? 'yes' : 'no'}`);
    console.log('');
    console.log('Run "scimax publish" to publish your project.');

    // Suggest creating a _toc.yml if it doesn't exist
    const tocPath = path.join(workspaceRoot, baseDir, '_toc.yml');
    if (!fs.existsSync(tocPath)) {
        console.log('');
        console.log('Tip: Create a _toc.yml file to define your table of contents:');
        console.log('');
        console.log('  format: jb-book');
        console.log('  root: index');
        console.log('  chapters:');
        console.log('    - file: chapter1');
        console.log('    - file: chapter2');
    }
}

/**
 * Print help for publish command
 */
export function publishHelp(): void {
    console.log(`
scimax publish - Publish org projects to HTML

USAGE:
    scimax publish [project] [options]

ARGUMENTS:
    [project]           Project name to publish (optional, publishes all if omitted)

OPTIONS:
    --init              Initialize a new publishing configuration
    --list              List configured projects
    --force             Force republish even if files are up to date
    --dry-run           Show what would be published without writing files

INIT OPTIONS:
    --name <name>       Project name (default: main)
    --base <dir>        Source directory (default: ./)
    --output <dir>      Output directory (default: ./_build/html)
    --github            Enable GitHub Pages support (default: true)
    --no-github         Disable GitHub Pages support
    --sitemap           Generate sitemap/index (default: true)
    --no-sitemap        Disable sitemap generation
    --yaml              Use YAML format (_config.yml) instead of JSON

EXAMPLES:
    scimax publish                  # Publish all projects
    scimax publish docs             # Publish 'docs' project only
    scimax publish --force          # Force republish all files
    scimax publish --dry-run        # Preview what would be published
    scimax publish --init           # Initialize with defaults
    scimax publish --init --yaml    # Initialize with YAML config
    scimax publish --list           # List configured projects

CONFIGURATION:
    Publishing configuration is read from:
      - _config.yml (Jupyter Book compatible YAML)
      - .org-publish.json (JSON format)

    Example .org-publish.json:
    {
      "projects": {
        "main": {
          "baseDirectory": "./docs",
          "publishingDirectory": "./_build/html",
          "recursive": true,
          "autoSitemap": true
        }
      },
      "githubPages": true
    }
`);
}
