"""Check brace balance in a JS file, ignoring strings and comments."""
import sys

def check_braces(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()
    
    depth = 0
    in_string = False
    in_line_comment = False
    in_block_comment = False
    string_char = None
    i = 0
    n = len(text)
    
    while i < n:
        c = text[i]
        nc = text[i+1] if i+1 < n else ''
        
        if in_line_comment:
            if c == '\n':
                in_line_comment = False
            i += 1
            continue
        
        if in_block_comment:
            if c == '*' and nc == '/':
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        
        if in_string:
            if c == '\\' and nc:
                i += 2  # skip escaped char
                continue
            if c == string_char:
                in_string = False
            i += 1
            continue
        
        if c == '/' and nc == '/':
            in_line_comment = True
            i += 2
            continue
        
        if c == '/' and nc == '*':
            in_block_comment = True
            i += 2
            continue
        
        if c == "'" or c == '"' or c == '`':
            in_string = True
            string_char = c
            i += 1
            continue
        
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth < 0:
                line_num = text[:i].count('\n') + 1
                # Find context
                line_start = text.rfind('\n', 0, i) + 1
                line_end = text.find('\n', i)
                if line_end < 0:
                    line_end = n
                print(f'NEGATIVE DEPTH at line {line_num}, col {i - line_start + 1}')
                print(f'  Line content: {text[line_start:line_end].rstrip()}')
                print(f'  Depth went to {depth}')
        
        i += 1
    
    line_num = text[:i].count('\n') + 1
    print(f'Final depth: {depth} at line {line_num} (should be 0)')
    
    if depth != 0:
        print('ERROR: Unbalanced braces!')
        return False
    return True

if __name__ == '__main__':
    filepath = sys.argv[1] if len(sys.argv) > 1 else r'z:\vsCode_projects\spine_preview\js\spine-loading.js'
    ok = check_braces(filepath)
    sys.exit(0 if ok else 1)
