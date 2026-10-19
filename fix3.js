const fs = require('fs');
let text = fs.readFileSync('src/frontend/src/components/layout/MainLayout.tsx', 'utf8');
text = text.replace('                        </button>\r\n                        </button>', '                        </button>');
text = text.replace('                        </button>\n                        </button>', '                        </button>');
fs.writeFileSync('src/frontend/src/components/layout/MainLayout.tsx', text, 'utf8');
