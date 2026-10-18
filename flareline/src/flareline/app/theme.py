"""Light / dark themes: flat, one accent colour, generous spacing."""
from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtGui import QColor, QFont, QGuiApplication, QPalette
from PySide6.QtCore import Qt


@dataclass(frozen=True)
class Tokens:
    bg: str
    surface: str
    surface_alt: str
    border: str
    text: str
    text_muted: str
    accent: str
    accent_text: str
    error: str
    warning: str
    info: str
    banner_bg: str
    banner_text: str
    view_bg: str
    tube: str
    centerline: str


LIGHT = Tokens(bg="#F5F6F8", surface="#FFFFFF", surface_alt="#EEF0F3", border="#D9DDE3",
               text="#1B1F24", text_muted="#5B6470", accent="#2563EB", accent_text="#FFFFFF",
               error="#C62828", warning="#B26A00", info="#47607A", banner_bg="#C62828",
               banner_text="#FFFFFF", view_bg="#FFFFFF", tube="#7A8794", centerline="#2563EB")
DARK = Tokens(bg="#16191D", surface="#1F2328", surface_alt="#2A2F36", border="#353B43",
              text="#E6E9ED", text_muted="#9AA3AE", accent="#4C8DFF", accent_text="#0B1220",
              error="#FF6B6B", warning="#FFB74D", info="#9DB4CC", banner_bg="#B71C1C",
              banner_text="#FFFFFF", view_bg="#1F2328", tube="#9AA6B2", centerline="#4C8DFF")


def system_is_dark() -> bool:
    hints = QGuiApplication.styleHints()
    try:
        return hints.colorScheme() == Qt.ColorScheme.Dark
    except AttributeError:  # older Qt
        return False


def tokens_for(mode: str) -> Tokens:
    if mode == "dark" or (mode == "system" and system_is_dark()):
        return DARK
    return LIGHT


def stylesheet(t: Tokens) -> str:
    return f"""
    QWidget {{ background: {t.bg}; color: {t.text}; font-size: 10pt; }}
    QMainWindow::separator {{ background: {t.border}; width: 1px; height: 1px; }}
    QSplitter::handle {{ background: {t.border}; }}
    QSplitter::handle:horizontal {{ width: 1px; }}
    QSplitter::handle:vertical {{ height: 1px; }}
    QFrame#Card, QWidget#Card {{ background: {t.surface}; border: 1px solid {t.border};
                                border-radius: 8px; }}
    QLabel {{ background: transparent; }}
    QLabel#H1 {{ font-size: 14pt; font-weight: 600; }}
    QLabel#H2 {{ font-size: 11pt; font-weight: 600; }}
    QLabel#Muted {{ color: {t.text_muted}; }}
    QLabel#Banner {{ background: {t.banner_bg}; color: {t.banner_text}; font-weight: 600;
                     padding: 8px 14px; }}
    QLabel#Chip {{ border-radius: 9px; padding: 1px 8px; font-size: 8.5pt; }}
    QLineEdit, QComboBox, QDoubleSpinBox, QSpinBox, QPlainTextEdit, QTextBrowser {{
        background: {t.surface}; border: 1px solid {t.border}; border-radius: 6px;
        padding: 5px 8px; selection-background-color: {t.accent};
        selection-color: {t.accent_text}; }}
    QLineEdit:focus, QComboBox:focus, QDoubleSpinBox:focus {{ border: 1px solid {t.accent}; }}
    QComboBox QAbstractItemView {{ background: {t.surface}; border: 1px solid {t.border}; }}
    QPushButton, QToolButton {{ background: {t.surface}; border: 1px solid {t.border};
        border-radius: 6px; padding: 6px 12px; }}
    QPushButton:hover, QToolButton:hover {{ border-color: {t.accent}; }}
    QPushButton#Primary {{ background: {t.accent}; color: {t.accent_text}; border: none; }}
    QToolButton:checked, QPushButton:checked {{ background: {t.accent};
        color: {t.accent_text}; border-color: {t.accent}; }}
    QListWidget#Steps {{ background: transparent; border: none; outline: none; }}
    QListWidget#Steps::item {{ padding: 9px 10px; border-radius: 6px; margin: 1px 0; }}
    QListWidget#Steps::item:selected {{ background: {t.accent}; color: {t.accent_text}; }}
    QListWidget#Steps::item:hover:!selected {{ background: {t.surface_alt}; }}
    QTableWidget, QTreeWidget {{ background: {t.surface}; alternate-background-color: {t.surface_alt};
        border: 1px solid {t.border}; border-radius: 6px; gridline-color: {t.border};
        selection-background-color: {t.accent}; selection-color: {t.accent_text}; }}
    QHeaderView::section {{ background: {t.surface_alt}; color: {t.text_muted}; border: none;
        border-bottom: 1px solid {t.border}; padding: 6px; font-weight: 600; }}
    QTabWidget::pane {{ border: 1px solid {t.border}; border-radius: 6px; top: -1px; }}
    QTabBar::tab {{ background: transparent; padding: 7px 14px; color: {t.text_muted};
        border-bottom: 2px solid transparent; }}
    QTabBar::tab:selected {{ color: {t.text}; border-bottom: 2px solid {t.accent}; }}
    QMenuBar {{ background: {t.surface}; border-bottom: 1px solid {t.border}; }}
    QMenuBar::item:selected {{ background: {t.surface_alt}; }}
    QMenu {{ background: {t.surface}; border: 1px solid {t.border}; }}
    QMenu::item:selected {{ background: {t.accent}; color: {t.accent_text}; }}
    QStatusBar {{ background: {t.surface}; border-top: 1px solid {t.border}; color: {t.text_muted}; }}
    QToolTip {{ background: {t.surface}; color: {t.text}; border: 1px solid {t.border};
        padding: 6px; }}
    QCheckBox {{ background: transparent; }}
    QScrollArea {{ border: none; }}
    """


def apply(app, mode: str) -> Tokens:
    t = tokens_for(mode)
    font = QFont()
    font.setFamilies(["Segoe UI", "Inter", "DejaVu Sans"])
    font.setPointSizeF(10)
    app.setFont(font)
    pal = QPalette()
    for role, colour in ((QPalette.Window, t.bg), (QPalette.Base, t.surface),
                         (QPalette.Text, t.text), (QPalette.WindowText, t.text),
                         (QPalette.Button, t.surface), (QPalette.ButtonText, t.text),
                         (QPalette.Highlight, t.accent), (QPalette.HighlightedText, t.accent_text),
                         (QPalette.ToolTipBase, t.surface), (QPalette.ToolTipText, t.text)):
        pal.setColor(role, QColor(colour))
    app.setPalette(pal)
    app.setStyleSheet(stylesheet(t))
    return t
