/**
 * LaTeX Commands Registration
 * Registers all LaTeX navigation, structure, and environment commands
 */

import * as vscode from 'vscode';
import { LaTeXDocumentSymbolProvider } from './latexDocumentSymbolProvider';
import { LaTeXHoverProvider } from './latexHoverProvider';
import * as navigation from './latexNavigation';
import * as structure from './latexStructure';
import * as environments from './latexEnvironments';
import { registerSpeedCommands } from './latexSpeedCommands';

/**
 * Register all LaTeX-related commands
 */
export function registerLatexCommands(context: vscode.ExtensionContext): void {
    // Navigation commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.nextSection', navigation.nextSection),
        vscode.commands.registerCommand('scimax.latex.previousSection', navigation.previousSection),
        vscode.commands.registerCommand('scimax.latex.parentSection', navigation.parentSection),
        vscode.commands.registerCommand('scimax.latex.nextSiblingSection', navigation.nextSiblingSection),
        vscode.commands.registerCommand('scimax.latex.previousSiblingSection', navigation.previousSiblingSection),
        vscode.commands.registerCommand('scimax.latex.firstSection', navigation.firstSection),
        vscode.commands.registerCommand('scimax.latex.lastSection', navigation.lastSection),
        vscode.commands.registerCommand('scimax.latex.jumpToSection', navigation.jumpToSection),
        vscode.commands.registerCommand('scimax.latex.nextEnvironment', navigation.nextEnvironment),
        vscode.commands.registerCommand('scimax.latex.previousEnvironment', navigation.previousEnvironment),
        vscode.commands.registerCommand('scimax.latex.jumpToEnvironment', navigation.jumpToEnvironment),
        vscode.commands.registerCommand('scimax.latex.jumpToLabel', navigation.jumpToLabel),
        vscode.commands.registerCommand('scimax.latex.jumpToMatchingEnvironment', navigation.jumpToMatchingEnvironment),
    );

    // Structure editing commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.promoteSection', structure.promoteSection),
        vscode.commands.registerCommand('scimax.latex.demoteSection', structure.demoteSection),
        vscode.commands.registerCommand('scimax.latex.promoteSubtree', structure.promoteSubtree),
        vscode.commands.registerCommand('scimax.latex.demoteSubtree', structure.demoteSubtree),
        vscode.commands.registerCommand('scimax.latex.moveSectionUp', structure.moveSectionUp),
        vscode.commands.registerCommand('scimax.latex.moveSectionDown', structure.moveSectionDown),
        vscode.commands.registerCommand('scimax.latex.markSection', structure.markSection),
        vscode.commands.registerCommand('scimax.latex.killSection', structure.killSection),
        vscode.commands.registerCommand('scimax.latex.cloneSection', structure.cloneSection),
        vscode.commands.registerCommand('scimax.latex.insertSection', structure.insertSection),
        vscode.commands.registerCommand('scimax.latex.insertSubsection', structure.insertSubsection),
        vscode.commands.registerCommand('scimax.latex.narrowToSection', structure.narrowToSection),
        vscode.commands.registerCommand('scimax.latex.widen', structure.widen),
    );

    // Environment commands
    context.subscriptions.push(
        vscode.commands.registerCommand('scimax.latex.selectEnvironment', environments.selectEnvironment),
        vscode.commands.registerCommand('scimax.latex.selectEnvironmentContent', environments.selectEnvironmentContent),
        vscode.commands.registerCommand('scimax.latex.changeEnvironment', environments.changeEnvironment),
        vscode.commands.registerCommand('scimax.latex.wrapInEnvironment', environments.wrapInEnvironment),
        vscode.commands.registerCommand('scimax.latex.unwrapEnvironment', environments.unwrapEnvironment),
        vscode.commands.registerCommand('scimax.latex.deleteEnvironment', environments.deleteEnvironment),
        vscode.commands.registerCommand('scimax.latex.toggleEnvironmentStar', environments.toggleEnvironmentStar),
        vscode.commands.registerCommand('scimax.latex.addLabel', environments.addLabelToEnvironment),
        vscode.commands.registerCommand('scimax.latex.addCaption', environments.addCaptionToEnvironment),
        vscode.commands.registerCommand('scimax.latex.environmentInfo', environments.environmentInfo),
    );

    // Register speed commands
    registerSpeedCommands(context);
}

/**
 * Register LaTeX language providers
 */
export function registerLatexProviders(context: vscode.ExtensionContext): void {
    // Document Symbol Provider (for outline view)
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: 'latex', scheme: 'file' },
            new LaTeXDocumentSymbolProvider()
        )
    );

    // Hover Provider (for tooltips)
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'latex', scheme: 'file' },
            new LaTeXHoverProvider()
        )
    );
}

/**
 * Activate all LaTeX features
 */
export function activateLatexFeatures(context: vscode.ExtensionContext): void {
    registerLatexCommands(context);
    registerLatexProviders(context);

    console.log('LaTeX navigation and structure features activated');
}
