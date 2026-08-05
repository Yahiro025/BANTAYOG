import sys
import re
import os

def remove_comments(text, file_ext):
    # Regex to match strings (single, double, backtick) or comments
    pattern = re.compile(
        r'(?P<string>"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`)'
        r'|(?P<block_comment>/\*.*?\*/)'
        r'|(?P<line_comment>//[^\r\n]*)',
        re.DOTALL | re.MULTILINE
    )

    def replacer(match):
        if match.group('string'):
            return match.group('string')
        elif match.group('block_comment'):
            # Convert block comments to single line comments (skip for tsx/jsx to avoid breaking JSX { /* */ })
            if file_ext in ['.tsx', '.jsx']:
                return match.group('block_comment')
                
            lines = match.group('block_comment').split('\n')
            result = []
            for line in lines:
                cleaned = line.replace('/*', '').replace('*/', '').strip()
                if cleaned.startswith('*'):
                    cleaned = cleaned[1:].strip()
                if cleaned:
                    # Ignore separator block comments
                    if re.match(r'^[-=]{10,}$', cleaned):
                        continue
                    result.append('// ' + cleaned)
            return '\n'.join(result) if result else ''
        elif match.group('line_comment'):
            # Remove long separator line comments
            line = match.group('line_comment')
            if re.match(r'^//\s*[-=]{10,}\s*$', line.strip()):
                return ''
            return line
        return ''

    # Clean up empty lines left behind by removed comments
    cleaned_text = pattern.sub(replacer, text)
    # Remove multiple blank lines
    cleaned_text = re.sub(r'\n\s*\n\s*\n', '\n\n', cleaned_text)
    return cleaned_text

def process_dir(directory):
    for root, dirs, files in os.walk(directory):
        if 'node_modules' in dirs:
            dirs.remove('node_modules')
        if '.next' in dirs:
            dirs.remove('.next')
        if 'dist' in dirs:
            dirs.remove('dist')
            
        for file in files:
            if file.endswith(('.ts', '.tsx', '.js', '.jsx')):
                path = os.path.join(root, file)
                _, file_ext = os.path.splitext(file)
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                new_content = remove_comments(content, file_ext)
                if new_content != content:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Processed: {path}")

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else '.'
    process_dir(target)
