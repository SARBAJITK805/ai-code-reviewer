import path from "path";
import { CodeIssue } from "../types/review";
import { GitHubFile } from "../types/github";

export class FileAnalysisService {
    private readonly SUPPORTED_EXTENSIONS = new Set([
        '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.php',
        '.rb', '.swift', '.kt', '.scala', '.cpp', '.c', '.cs', '.dart'
    ]);

    private readonly IGNORE_PATTERNS = [
        /node_modules/,
        /\.min\./,
        /\.bundle\./,
        /\.generated\./,
        /dist\//,
        /build\//,
        /coverage\//,
        /\.git\//,
        /vendor\//,
        /packages\/.*\/lib\//
    ];

    private readonly BINARY_EXTENSIONS = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.pdf', '.zip',
        '.tar', '.gz', '.exe', '.dll', '.so', '.dylib'
    ]);

    // Fixed typo: sholudReview -> shouldReview
    shouldReview(filename: string, status: string) {
        if (status == 'removed') {
            return false
        }
        const ext = path.extname(filename).toLowerCase();
        if (this.BINARY_EXTENSIONS.has(ext)) {
            return false;
        }
        if (this.IGNORE_PATTERNS.some(pattern => pattern.test(filename))) {
            return false;
        }

        if (!this.SUPPORTED_EXTENSIONS.has(ext)) {
            return !ext || this.isConfigFile(filename);
        }
        return true;
    }

    private isConfigFile(filename: string): boolean {
        const configFiles = [
            'Dockerfile', 'Makefile', 'package.json', 'tsconfig.json',
            'webpack.config.js', '.eslintrc', '.babelrc', 'docker-compose.yml'
        ];

        const basename = path.basename(filename);
        return configFiles.includes(basename) || basename.startsWith('.');
    }

    getLanguage(filename: string): string {
        const ext = path.extname(filename).toLowerCase();

        const languageMap: Record<string, string> = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.cpp': 'cpp',
            '.c': 'c',
            '.cs': 'csharp',
            '.dart': 'dart'
        };

        return languageMap[ext] || 'unknown';
    }
    
    analyzeFile(file: GitHubFile) {
        const shouldReview = this.shouldReview(file.filename, file.status);
        const language = this.getLanguage(file.filename)

        const analysis = {
            filename: file.filename,
            language,
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch || '',
            shouldReview,
            issues: []
        }

        if (shouldReview && file.patch) {
            analysis.issues = this.performBasicAnalysis(file.patch, language);
        }
        return analysis;
    }

    private performBasicAnalysis(patch: string, language: string): CodeIssue[] {
        const issues: CodeIssue[] = [];
        const lines = patch.split('\n');
        let currentLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith('@@')) {
                const match = line.match(/\+(\d+)/);
                if (match) {
                    currentLine = parseInt(match[1]) - 1;
                }
                continue;
            }

            if (line.startsWith('+')) {
                currentLine++;
                const codeContent = line.substring(1);

                const lineIssues = this.checkLineForIssues(codeContent, currentLine, language);
                issues.push(...lineIssues);
            }
        }

        return issues;
    }
    
    private checkLineForIssues(line: string, lineNumber: number, language: string): CodeIssue[] {
        const issues: CodeIssue[] = [];
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('#')) {
            return issues;
        }

        this.checkCommonIssues(line, lineNumber, issues);

        switch (language) {
            case 'javascript':
            case 'typescript':
                this.checkJavaScriptIssues(line, lineNumber, issues);
                break;
            case 'python':
                this.checkPythonIssues(line, lineNumber, issues);
                break;
            default:
                break;
        }

        return issues;
    }

    private checkCommonIssues(line: string, lineNumber: number, issues: CodeIssue[]): void {
        const secretPatterns = [
            /password\s*[=:]\s*["'][^"']+["']/i,
            /api[_-]?key\s*[=:]\s*["'][^"']+["']/i,
            /secret\s*[=:]\s*["'][^"']+["']/i,
            /token\s*[=:]\s*["'][^"']+["']/i
        ];

        for (const pattern of secretPatterns) {
            if (pattern.test(line)) {
                issues.push({
                    line: lineNumber,
                    severity: 'critical',
                    type: 'security',
                    message: 'Potential hardcoded credential detected',
                    suggestion: 'Use environment variables or secure credential storage',
                    rule: 'no-hardcoded-credentials'
                });
            }
        }

        if (/TODO|FIXME|HACK/i.test(line)) {
            issues.push({
                line: lineNumber,
                severity: 'low',
                type: 'quality',
                message: 'TODO comment found',
                suggestion: 'Consider creating an issue or completing the task',
                rule: 'no-todo-comments'
            });
        }
    }

    private checkJavaScriptIssues(line: string, lineNumber: number, issues: CodeIssue[]): void {
        if (/console\.log\s*\(/.test(line)) {
            issues.push({
                line: lineNumber,
                severity: 'medium',
                type: 'quality',
                message: 'Console.log statement found',
                suggestion: 'Remove console.log or use proper logging library',
                rule: 'no-console'
            });
        }

        if (/[^=!]==[^=]/.test(line)) {
            issues.push({
                line: lineNumber,
                severity: 'medium',
                type: 'quality',
                message: 'Use strict equality (===) instead of loose equality (==)',
                suggestion: 'Replace == with ===',
                rule: 'strict-equality'
            });
        }

        if (/\bvar\s+\w+/.test(line)) {
            issues.push({
                line: lineNumber,
                severity: 'low',
                type: 'quality',
                message: 'Use let or const instead of var',
                suggestion: 'Replace var with let or const',
                rule: 'no-var'
            });
        }

        if (/\beval\s*\(/.test(line)) {
            issues.push({
                line: lineNumber,
                severity: 'high',
                type: 'security',
                message: 'eval() usage detected - potential security risk',
                suggestion: 'Avoid using eval(), consider safer alternatives',
                rule: 'no-eval'
            });
        }
    }

    private checkPythonIssues(line: string, lineNumber: number, issues: CodeIssue[]): void {
        if (/\bprint\s*\(/.test(line)) {
            issues.push({
                line: lineNumber,
                severity: 'low',
                type: 'quality',
                message: 'Print statement found',
                suggestion: 'Use logging instead of print for production code',
                rule: 'no-print'
            });
        }

        if (/except\s*:/.test(line)) {
            issues.push({
                line: lineNumber,
                severity: 'medium',
                type: 'quality',
                message: 'Bare except clause',
                suggestion: 'Catch specific exceptions instead of using bare except',
                rule: 'specific-exceptions'
            });
        }
    }

    getComplexityScore(patch: string): number {
        const lines = patch.split('\n').filter(line => line.startsWith('+')).length;
        const nestingLevel = this.calculateNestingLevel(patch);

        return Math.min(10, Math.floor(lines / 10) + nestingLevel);
    }

    private calculateNestingLevel(patch: string): number {
        let maxNesting = 0;
        let currentNesting = 0;

        const lines = patch.split('\n');
        for (const line of lines) {
            if (line.startsWith('+')) {
                const content = line.substring(1);
                const openBraces = (content.match(/[{([]|if|for|while|function|class/g) || []).length;
                const closeBraces = (content.match(/[})\]]/g) || []).length;

                currentNesting += openBraces - closeBraces;
                maxNesting = Math.max(maxNesting, currentNesting);
            }
        }

        return Math.max(0, maxNesting);
    }
}

export const fileAnalysisService = new FileAnalysisService();